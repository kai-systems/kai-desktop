import { createHash } from 'crypto';
import { mkdirSync, existsSync, readFileSync, rmSync, copyFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { dirname, extname, join, normalize, relative, resolve } from 'path';
import type * as Esbuild from 'esbuild';
import type { PluginRendererBuild, PluginRendererScript, PluginRendererStyle } from './types.js';

const CACHE_DIRNAME = 'plugin-renderers';
const MANIFEST_FILENAME = 'renderer-build.json';

const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

export const PLUGIN_RENDERER_PROTOCOL = 'plugin-renderer';

let esbuildModulePromise: Promise<typeof Esbuild> | null = null;

type RendererBuildManifest = {
  fileHash: string;
  entryPath: string;
  entryUrl: string;
  scriptPath: string;
  stylePaths: string[];
  mimeTypes: Record<string, string>;
};

type UrlScanResult = {
  scriptEntries: Set<string>;
  assetPaths: Set<string>;
};

function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function inferContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
  };
  return mimeTypes[ext] ?? 'application/octet-stream';
}

function configureEsbuildBinaryPath(): void {
  if (process.env.ESBUILD_BINARY_PATH) return;

  const binaryName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const bundledBinaryPath = join(process.resourcesPath, 'esbuild', 'bin', binaryName);
  if (existsSync(bundledBinaryPath)) {
    process.env.ESBUILD_BINARY_PATH = bundledBinaryPath;
  }
}

async function getEsbuild(): Promise<typeof Esbuild> {
  configureEsbuildBinaryPath();
  esbuildModulePromise ??= import('esbuild');
  return esbuildModulePromise;
}

function rendererCacheRoot(appHome: string, pluginName: string, fileHash: string): string {
  return join(appHome, CACHE_DIRNAME, pluginName, fileHash);
}

function rendererBuildUrl(pluginName: string, fileHash: string, relativePath: string): string {
  return `${PLUGIN_RENDERER_PROTOCOL}://${encodeURIComponent(pluginName)}/${encodeURIComponent(fileHash)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function resolveBuildOutputPath(baseDir: string, outputPath: string): string {
  return normalize(resolve(baseDir, outputPath));
}

function findExistingFile(basePath: string): string | null {
  if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;

  for (const extension of SCRIPT_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function resolveUrlReference(pluginDir: string, sourceDir: string, ref: string): string | null {
  const resolved = resolve(sourceDir, ref);
  const pluginRoot = pluginDir.endsWith('/') ? pluginDir : `${pluginDir}/`;
  if (resolved !== pluginDir && !resolved.startsWith(pluginRoot)) return null;
  return findExistingFile(resolved) ?? (existsSync(resolved) ? resolved : null);
}

function collectPluginSourceFiles(currentDir: string): string[] {
  if (!existsSync(currentDir)) return [];
  const dirents = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];

  for (const entry of dirents) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPluginSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanImportMetaUrlReferences(pluginDir: string, mainPath: string): UrlScanResult {
  const scriptEntries = new Set<string>();
  const assetPaths = new Set<string>();
  const files = collectPluginSourceFiles(pluginDir);
  const pattern = /new\s+URL\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*import\.meta\.url\s*\)/g;

  for (const filePath of files) {
    if (filePath === mainPath) continue;
    if (!SCRIPT_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;

    const source = readFileSync(filePath, 'utf-8');
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match) {
      const ref = match[2];
      if (ref.startsWith('./') || ref.startsWith('../')) {
        const resolved = resolveUrlReference(pluginDir, dirname(filePath), ref);
        if (resolved) {
          if (SCRIPT_EXTENSIONS.has(extname(resolved).toLowerCase())) {
            scriptEntries.add(normalizeRelativePath(relative(pluginDir, resolved)));
          } else {
            assetPaths.add(normalizeRelativePath(relative(pluginDir, resolved)));
          }
        }
      }
      match = pattern.exec(source);
    }
  }

  return { scriptEntries, assetPaths };
}

function loadCachedBuild(appHome: string, pluginName: string, pluginDir: string, fileHash: string): PluginRendererBuild | null {
  const outDir = rendererCacheRoot(appHome, pluginName, fileHash);
  const manifestPath = join(outDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RendererBuildManifest;
    if (manifest.fileHash !== fileHash) return null;
    const scriptPath = join(outDir, manifest.scriptPath);
    if (!existsSync(scriptPath)) return null;

    const scripts: PluginRendererScript[] = [{
      pluginName,
      scriptPath,
      scriptHash: hashContent(readFileSync(scriptPath)),
      entryUrl: manifest.entryUrl,
    }];

    const styles = manifest.stylePaths
      .map((stylePath): PluginRendererStyle | null => {
        const fullPath = join(outDir, stylePath);
        if (!existsSync(fullPath)) return null;
        return {
          pluginName,
          stylePath: fullPath,
          styleHash: hashContent(readFileSync(fullPath)),
          styleUrl: rendererBuildUrl(pluginName, fileHash, stylePath),
        };
      })
      .filter((value): value is PluginRendererStyle => value !== null);

    return {
      pluginName,
      pluginDir,
      fileHash,
      outDir,
      entryPath: manifest.entryPath,
      entryUrl: manifest.entryUrl,
      scripts,
      styles,
      mimeTypes: manifest.mimeTypes,
    };
  } catch {
    return null;
  }
}

export async function buildPluginRendererBundle(options: {
  appHome: string;
  pluginName: string;
  pluginDir: string;
  fileHash: string;
  rendererPath: string;
  mainPath: string;
}): Promise<PluginRendererBuild> {
  const cached = loadCachedBuild(options.appHome, options.pluginName, options.pluginDir, options.fileHash);
  if (cached) return cached;

  const outDir = rendererCacheRoot(options.appHome, options.pluginName, options.fileHash);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const rendererEntryAbs = join(options.pluginDir, options.rendererPath);
  if (!existsSync(rendererEntryAbs)) {
    throw new Error(`Plugin renderer entry point not found: ${rendererEntryAbs}`);
  }

  const { scriptEntries, assetPaths } = scanImportMetaUrlReferences(options.pluginDir, join(options.pluginDir, options.mainPath));
  scriptEntries.add(normalizeRelativePath(options.rendererPath));

  const entryPointList = [...scriptEntries].sort();

  let result;
  try {
    const esbuild = await getEsbuild();
    result = await esbuild.build({
      absWorkingDir: options.pluginDir,
      assetNames: 'assets/[name]-[hash]',
      bundle: true,
      chunkNames: 'chunks/[name]-[hash]',
      entryNames: '[dir]/[name]',
      entryPoints: entryPointList,
      format: 'esm',
      legalComments: 'none',
      loader: {
        '.avif': 'file',
        '.bmp': 'file',
        '.css': 'css',
        '.gif': 'file',
        '.jpeg': 'file',
        '.jpg': 'file',
        '.json': 'json',
        '.mp3': 'file',
        '.mp4': 'file',
        '.ogg': 'file',
        '.otf': 'file',
        '.png': 'file',
        '.svg': 'file',
        '.ttf': 'file',
        '.txt': 'text',
        '.wav': 'file',
        '.wasm': 'file',
        '.webm': 'file',
        '.webp': 'file',
        '.woff': 'file',
        '.woff2': 'file',
      },
      logLevel: 'silent',
      metafile: true,
      outdir: outDir,
      outbase: '.',
      platform: 'browser',
      sourcemap: 'inline',
      splitting: true,
      target: ['chrome120', 'safari17'],
      write: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to build renderer bundle for plugin "${options.pluginName}": ${message}`);
  }

  const outputs = result.metafile?.outputs ?? {};
  const entryOutputBySource = new Map<string, string>();
  const stylePaths = new Set<string>();

  for (const [outputPath, outputMeta] of Object.entries(outputs)) {
    const outputFullPath = resolveBuildOutputPath(options.pluginDir, outputPath);
    const entryPoint = outputMeta.entryPoint ? normalizeRelativePath(outputMeta.entryPoint) : null;
    const outputRelative = normalizeRelativePath(relative(outDir, outputFullPath));
    if (entryPoint) {
      entryOutputBySource.set(entryPoint, outputRelative);
    }
    if (outputRelative.endsWith('.css')) {
      stylePaths.add(outputRelative);
    }
    if (outputMeta.cssBundle) {
      const cssBundleFullPath = resolveBuildOutputPath(options.pluginDir, outputMeta.cssBundle);
      stylePaths.add(normalizeRelativePath(relative(outDir, cssBundleFullPath)));
    }
  }

  const mimeTypes: Record<string, string> = {};
  const rendererOutputRelative = entryOutputBySource.get(normalizeRelativePath(options.rendererPath));
  if (!rendererOutputRelative) {
    throw new Error(`Renderer build for plugin "${options.pluginName}" did not produce an entry output for ${options.rendererPath}`);
  }

  for (const sourceRelative of entryPointList) {
    const outputRelative = entryOutputBySource.get(sourceRelative);
    if (!outputRelative) continue;
    if (outputRelative === sourceRelative) continue;

    const outputFullPath = join(outDir, outputRelative);
    const aliasFullPath = join(outDir, sourceRelative);
    mkdirSync(dirname(aliasFullPath), { recursive: true });
    copyFileSync(outputFullPath, aliasFullPath);
    mimeTypes[sourceRelative] = 'text/javascript; charset=utf-8';
  }

  for (const assetRelative of assetPaths) {
    const sourceFullPath = join(options.pluginDir, assetRelative);
    const destFullPath = join(outDir, assetRelative);
    if (!existsSync(sourceFullPath) || existsSync(destFullPath)) continue;
    mkdirSync(dirname(destFullPath), { recursive: true });
    copyFileSync(sourceFullPath, destFullPath);
  }

  const entryRequestPath = normalizeRelativePath(options.rendererPath);
  const entryFullPath = join(outDir, entryRequestPath);
  const entryUrl = rendererBuildUrl(options.pluginName, options.fileHash, entryRequestPath);
  mimeTypes[entryRequestPath] = 'text/javascript; charset=utf-8';

  const scripts: PluginRendererScript[] = [{
    pluginName: options.pluginName,
    scriptPath: entryFullPath,
    scriptHash: hashContent(readFileSync(entryFullPath)),
    entryUrl,
  }];

  const styles: PluginRendererStyle[] = [...stylePaths]
    .sort()
    .map((styleRelativePath) => {
      const stylePath = join(outDir, styleRelativePath);
      return {
        pluginName: options.pluginName,
        stylePath,
        styleHash: hashContent(readFileSync(stylePath)),
        styleUrl: rendererBuildUrl(options.pluginName, options.fileHash, styleRelativePath),
      };
    });

  const manifest: RendererBuildManifest = {
    fileHash: options.fileHash,
    entryPath: entryRequestPath,
    entryUrl,
    scriptPath: entryRequestPath,
    stylePaths: [...stylePaths].sort(),
    mimeTypes,
  };
  writeFileSync(join(outDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    pluginName: options.pluginName,
    pluginDir: options.pluginDir,
    fileHash: options.fileHash,
    outDir,
    entryPath: entryRequestPath,
    entryUrl,
    scripts,
    styles,
    mimeTypes,
  };
}

export function resolvePluginRendererRequest(options: {
  appHome: string;
  pluginName: string;
  fileHash: string;
  assetPath: string;
  build: PluginRendererBuild | null;
}): { filePath: string; contentType: string } | null {
  const expectedRoot = rendererCacheRoot(options.appHome, options.pluginName, options.fileHash);
  const buildRoot = options.build?.outDir;
  if (!buildRoot || buildRoot !== expectedRoot) return null;

  const relativePath = normalizeRelativePath(normalize(options.assetPath).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!relativePath || relativePath.startsWith('..')) return null;

  const fullPath = resolve(expectedRoot, relativePath);
  const expectedPrefix = expectedRoot.endsWith('/') ? expectedRoot : `${expectedRoot}/`;
  if (fullPath !== expectedRoot && !fullPath.startsWith(expectedPrefix)) return null;
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) return null;

  return {
    filePath: fullPath,
    contentType: options.build?.mimeTypes[relativePath] ?? inferContentType(fullPath),
  };
}
