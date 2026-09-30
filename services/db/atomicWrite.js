/**
 * 原子写文件：写同目录临时文件 → fsync → rename 覆盖
 *
 * rename 在同一文件系统内是原子的，读取方任何时刻只能看到完整的旧文件或完整的新文件。
 */
const fs = require('fs');
const path = require('path');

let _seq = 0;

function writeFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${++_seq}.tmp`);
    let fd = null;
    try {
        fd = fs.openSync(tmp, 'w');
        fs.writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tmp, filePath);
    } catch (err) {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) { /* ignore */ }
        }
        try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
        throw err;
    }
}

function writeJsonAtomic(filePath, obj, pretty = false) {
    writeFileAtomic(filePath, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}

/** 清理进程异常退出后遗留的临时文件 */
function cleanupTempFiles(dir) {
    try {
        if (!fs.existsSync(dir)) return 0;
        let n = 0;
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith('.') && f.endsWith('.tmp')) {
                try { fs.unlinkSync(path.join(dir, f)); n++; } catch (e) { /* ignore */ }
            }
        }
        return n;
    } catch (e) {
        return 0;
    }
}

module.exports = { writeFileAtomic, writeJsonAtomic, cleanupTempFiles };
