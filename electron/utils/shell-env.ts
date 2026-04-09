import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PATH_RESOLVE_TIMEOUT_MS = 4000;
const PATH_RESOLVE_CACHE_MS = 5 * 60 * 1000;
const PATH_MARKER_START = '__KAI_PATH_START__';
const PATH_MARKER_END = '__KAI_PATH_END__';

let cachedResolvedPath: string | null = null;
let cachedResolvedAt = 0;
let inFlightResolution: Promise<string> | null = null;

function defaultPathEntries(): string[] {
  if (process.platform === 'win32') return [];

  const entries = [
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
  ];

  if (process.platform === 'darwin') {
    entries.push(
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/Library/Developer/CommandLineTools/usr/bin',
    );
  }

  return entries;
}

function dedupePathEntries(pathValues: Array<string | undefined | null>): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const pathValue of pathValues) {
    if (!pathValue) continue;

    for (const entry of pathValue.split(delimiter)) {
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }

  return merged.join(delimiter);
}

function resolveEnvPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path')
    ?? (process.platform === 'win32' ? 'Path' : 'PATH');
}

function getEnvPath(env: NodeJS.ProcessEnv): string {
  const key = resolveEnvPathKey(env);
  return env[key] ?? env.PATH ?? '';
}

function normalizePathValue(pathValue: string): string {
  return dedupePathEntries([pathValue, defaultPathEntries().join(delimiter)]);
}

function cacheResolvedPath(pathValue: string): string {
  const normalized = normalizePathValue(pathValue);
  cachedResolvedPath = normalized;
  cachedResolvedAt = Date.now();
  process.env.PATH = normalized;
  return normalized;
}

function buildShellProbeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: normalizePathValue(getEnvPath(process.env)),
    TERM: process.env.TERM || 'dumb',
    PS1: '',
    PROMPT: '',
    PROMPT_COMMAND: '',
  };
}

function parseResolvedPath(stdout: string): string | null {
  const markerStart = stdout.lastIndexOf(PATH_MARKER_START);
  if (markerStart === -1) return null;

  const valueStart = markerStart + PATH_MARKER_START.length;
  const markerEnd = stdout.indexOf(PATH_MARKER_END, valueStart);
  if (markerEnd === -1) return null;

  const pathValue = stdout.slice(valueStart, markerEnd).trim();
  return pathValue || null;
}

function shellCandidates(): string[] {
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((candidate): candidate is string => Boolean(candidate));

  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}

async function probeShellPath(shellPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(shellPath, args, {
      env: buildShellProbeEnv(),
      timeout: PATH_RESOLVE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    return parseResolvedPath(stdout);
  } catch {
    return null;
  }
}

async function detectShellPath(): Promise<string | null> {
  if (process.platform === 'win32') {
    return getEnvPath(process.env) || null;
  }

  const command = `printf '${PATH_MARKER_START}%s${PATH_MARKER_END}' "$PATH"`;

  for (const shellPath of shellCandidates()) {
    const interactiveLoginPath = await probeShellPath(shellPath, ['-ilc', command]);
    if (interactiveLoginPath) return interactiveLoginPath;

    const loginPath = await probeShellPath(shellPath, ['-lc', command]);
    if (loginPath) return loginPath;
  }

  return null;
}

export async function primeResolvedShellPath(force = false): Promise<string> {
  const isCacheFresh = cachedResolvedPath !== null && (Date.now() - cachedResolvedAt) < PATH_RESOLVE_CACHE_MS;
  if (!force && isCacheFresh && cachedResolvedPath !== null) return cachedResolvedPath;

  if (!force && inFlightResolution) return inFlightResolution;

  inFlightResolution = (async () => {
    const currentPath = normalizePathValue(getEnvPath(process.env));
    const detectedPath = await detectShellPath();

    return cacheResolvedPath(dedupePathEntries([detectedPath, currentPath]));
  })().finally(() => {
    inFlightResolution = null;
  });

  return inFlightResolution;
}

export function getResolvedShellPathSync(): string {
  return cachedResolvedPath
    ? normalizePathValue(cachedResolvedPath)
    : normalizePathValue(getEnvPath(process.env));
}

export function getResolvedProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const pathKey = resolveEnvPathKey(env);
  const pathValue = getResolvedShellPathSync();
  return {
    ...env,
    [pathKey]: pathValue,
    PATH: pathValue,
  };
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinaryPathSync(binaryName: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!binaryName.trim()) return null;

  if (binaryName.includes('/') || binaryName.includes('\\')) {
    return isExecutable(binaryName) ? binaryName : null;
  }

  const pathEntries = getResolvedProcessEnv(env).PATH?.split(delimiter).filter(Boolean) ?? [];

  if (process.platform === 'win32') {
    const pathext = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((ext) => ext.toLowerCase());
    const hasExtension = /\.[^./\\]+$/.test(binaryName);

    for (const dir of pathEntries) {
      const directCandidate = `${dir}\\${binaryName}`;
      if (hasExtension && isExecutable(directCandidate)) return directCandidate;

      for (const ext of pathext) {
        const candidate = hasExtension ? directCandidate : `${directCandidate}${ext}`;
        if (isExecutable(candidate)) return candidate;
      }
    }

    return null;
  }

  for (const dir of pathEntries) {
    const candidate = `${dir}/${binaryName}`;
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

export function binaryExistsInResolvedPath(binaryName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveBinaryPathSync(binaryName, env) !== null;
}
