const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.html', '.htm', '.css', '.svg', '.md', '.txt']);

class LunoServer {
  static getRootDir() { return ROOT_DIR; }
  static getWebRootDir() { return ROOT_DIR; }
  static getGitRootDir() { return ROOT_DIR; }

  static resolveProjectBaseDir(projectName) {
    const p = projectName || 'Luno';
    if (p === 'Luno') return path.join(ROOT_DIR, 'Luno');
    if (p === 'Library') return path.join(ROOT_DIR, 'Library');
    if (p === 'MySituation') {
      if (fs.existsSync(path.join(ROOT_DIR, 'situation'))) return path.join(ROOT_DIR, 'situation');
      if (fs.existsSync(path.join(ROOT_DIR, 'MySituation'))) return path.join(ROOT_DIR, 'MySituation');
    }
    return path.join(ROOT_DIR, p);
  }

  static getProjectList() {
    if (!fs.existsSync(ROOT_DIR)) return [];
    const items = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
    const projects = [];

    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        const projDir = path.join(ROOT_DIR, item.name);
        const lunoJsonPath = path.join(projDir, 'luno.json');
        let meta = { name: item.name, version: '1.0.0', description: '' };

        if (fs.existsSync(lunoJsonPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(lunoJsonPath, 'utf8'));
          } catch (e) {}
        }

        let fileCount = 0;
        try {
          const countFiles = (dir) => {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const f of list) {
              if (f.name.startsWith('.') || f.name === 'node_modules') continue;
              if (f.isDirectory()) countFiles(path.join(dir, f.name));
              else fileCount++;
            }
          };
          countFiles(projDir);
        } catch (e) {}

        projects.push({
          name: item.name,
          version: meta.version || '1.0.0',
          description: meta.description || '',
          fileCount: fileCount,
          isLibrary: item.name.toLowerCase() === 'library'
        });
      }
    }
    return projects;
  }

  static scanDirectory(dir, baseDir = '') {
    let results = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const relPath = baseDir ? path.join(baseDir, item.name) : item.name;
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        results.push({ name: item.name, relativePath: relPath.replace(/\\/g, '/'), isDirectory: true, size: 0 });
        results = results.concat(LunoServer.scanDirectory(fullPath, relPath));
      } else {
        const stats = fs.statSync(fullPath);
        results.push({
          name: item.name,
          relativePath: relPath.replace(/\\/g, '/'),
          isDirectory: false,
          size: stats.size,
          mtimeMs: stats.mtimeMs
        });
      }
    }
    return results;
  }
}

globalThis.LunoServer = LunoServer;

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const projectParam = parsedUrl.searchParams.get('project') || '';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API: Ping
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'online', mode: 'server', rootDir: ROOT_DIR, version: 'v3.7.7' }));
  }

  // API: Projects List
  if (pathname === '/api/projects/list') {
    const projects = LunoServer.getProjectList();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, projects, parentDir: ROOT_DIR }));
  }

  // API: File System List
  if (pathname === '/api/fs/ls') {
    const queryProj = projectParam || 'Luno';
    const targetDir = LunoServer.resolveProjectBaseDir(queryProj);
    const items = LunoServer.scanDirectory(targetDir, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, items }));
  }

  // API: Read File
  if (pathname === '/api/fs/read') {
    const relPath = parsedUrl.searchParams.get('path') || '';
    const queryProj = projectParam || '';
    let fullPath = '';

    if (relPath.startsWith('Library/') || relPath.startsWith('library/')) {
      fullPath = path.join(ROOT_DIR, 'Library', relPath.replace(/^library\//i, ''));
    } else if (queryProj) {
      fullPath = path.join(LunoServer.resolveProjectBaseDir(queryProj), relPath.replace(new RegExp(`^${queryProj}/`), ''));
    } else {
      fullPath = path.join(ROOT_DIR, relPath);
    }

    if (!fs.existsSync(fullPath) && queryProj === 'Luno') {
      const alt = path.join(ROOT_DIR, 'Luno', relPath);
      if (fs.existsSync(alt)) fullPath = alt;
    }

    if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, content, size: content.length, filePath: relPath }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `File not found: ${relPath}` }));
    }
  }

  // API: All Code (Filters binaries to prevent bloated bundles)
  if (pathname === '/api/all-code') {
    const queryProj = projectParam || 'Luno';
    const projDir = LunoServer.resolveProjectBaseDir(queryProj);
    const files = LunoServer.scanDirectory(projDir, '');
    const filesMap = {};
    const manifest = [];

    for (const f of files) {
      if (!f.isDirectory) {
        const ext = path.extname(f.relativePath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) continue;

        const fullP = path.join(projDir, f.relativePath);
        const code = fs.readFileSync(fullP, 'utf8');
        const key = `${queryProj}/${f.relativePath}`;
        manifest.push(key);
        filesMap[key] = code;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      activeProjectName: queryProj,
      activeRootDir: projDir,
      manifest,
      filesMap
    }));
  }

  // API: Save Payload & Execute Server Scripts
  if (pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetProj = projectParam || payload.project || 'Luno';
        const projBase = LunoServer.resolveProjectBaseDir(targetProj);
        let modifiedCount = 0;

        if (Array.isArray(payload.files)) {
          for (const f of payload.files) {
            let writePath = f.filePath || '';
            let targetFile = '';

            if (writePath.startsWith('Library/') || writePath.startsWith('library/')) {
              targetFile = path.join(ROOT_DIR, 'Library', writePath.replace(/^library\//i, ''));
            } else {
              if (writePath.startsWith(`${targetProj}/`)) {
                writePath = writePath.slice(targetProj.length + 1);
              }
              targetFile = path.join(projBase, writePath);
            }

            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.writeFileSync(targetFile, f.content !== undefined ? f.content : '', 'utf8');
            modifiedCount++;
          }
        }

        let scriptOutput = '';
        if (payload.serverScript) {
          try {
            const runner = new Function('require', 'LunoServer', 'process', '__dirname', payload.serverScript);
            const resVal = runner(require, LunoServer, process, ROOT_DIR);
            scriptOutput = `\n⚡ SERVER SCRIPT OUTPUT:\n${typeof resVal === 'object' ? JSON.stringify(resVal, null, 2) : String(resVal)}`;
          } catch (scriptErr) {
            scriptOutput = `\n❌ SERVER SCRIPT ERROR: ${scriptErr.message}\n${scriptErr.stack}`;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          count: modifiedCount,
          modifiedCount: modifiedCount,
          llmFeedback: `✅ Saved ${modifiedCount} file(s) in [${targetProj}] successfully.${scriptOutput}`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: Git Deploy
  if (pathname === '/api/deploy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const pName = projectParam || payload.project || 'Luno';
        const projDir = LunoServer.resolveProjectBaseDir(pName);
        const commitMsg = payload.commitMsg || `[${pName}] Update via Luno Workspace`;

        let output = '';
        output += execSync('git add -A', { cwd: projDir, encoding: 'utf8' }) || '';
        output += execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}" --allow-empty`, { cwd: projDir, encoding: 'utf8' }) || '';
        output += execSync('git push origin main', { cwd: projDir, encoding: 'utf8' }) || '';

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, output: output.trim() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // App Preview Route with <base href> Injection to prevent recursive Luno booting
  if (pathname === '/app-preview') {
    const pName = projectParam || 'Basic3D';
    const projDir = LunoServer.resolveProjectBaseDir(pName);
    const indexPath = path.join(projDir, 'index.html');

    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, 'utf8');
      const baseTag = `<base href="/${pName}/">`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n  ${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>\n  ${baseTag}`);
      } else {
        html = `${baseTag}\n` + html;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
  }

  // Static File Dispatcher
  let filePath = '';
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(ROOT_DIR, 'Luno', 'index.html');
    if (!fs.existsSync(filePath)) filePath = path.join(ROOT_DIR, 'index.html');
  } else {
    filePath = path.join(ROOT_DIR, pathname);

    // Fallback 1: Check inside Luno/
    if (!fs.existsSync(filePath)) {
      const lunoAlt = path.join(ROOT_DIR, 'Luno', pathname);
      if (fs.existsSync(lunoAlt)) filePath = lunoAlt;
    }

    // Fallback 2: Check inside Library/ for shared modules
    if (!fs.existsSync(filePath)) {
      const libAlt = path.join(ROOT_DIR, 'Library', path.basename(pathname));
      if (fs.existsSync(libAlt)) filePath = libAlt;
    }

    // Fallback 3: Subproject requesting /<Project>/library/<file> -> fallback to Library/<file>
    if (!fs.existsSync(filePath) && pathname.toLowerCase().includes('/library/')) {
      const fileName = path.basename(pathname);
      const centralLib = path.join(ROOT_DIR, 'Library', fileName);
      if (fs.existsSync(centralLib)) filePath = centralLib;
    }
  }

  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${pathname}`);
  }
});

server.listen(PORT, () => {
  console.log(`🌙 Luno Workspace Server running at: http://localhost:${PORT}`);
  console.log(`📁 Workspace Root: ${ROOT_DIR}`);
});