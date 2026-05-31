const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Pre-load WASM module
const sqlJsPromise = initSqlJs();

async function ensureLoaded() {
  if (!module.exports._SQL) {
    module.exports._SQL = await sqlJsPromise;
  }
  return module.exports._SQL;
}

module.exports = ensureLoaded;

module.exports.Database = class CompatDB {
  constructor(SQL, filePath) {
    this._filePath = filePath;
    this._closed = false;
    this._needsSave = false;

    if (filePath && fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }
  }

  _checkClosed() {
    if (this._closed) throw new Error('Database is closed');
  }

  pragma(str) {
    this._checkClosed();
    try { this._db.run(`PRAGMA ${str}`); } catch (e) {}
  }

  exec(sql) {
    this._checkClosed();
    this._db.exec(sql);
    this._queueSave();
  }

  prepare(sql) {
    const self = this;
    return {
      get(...params) {
        self._checkClosed();
        let stmt;
        try {
          stmt = self._db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
            return row;
          }
          return undefined;
        } catch (e) {
          return undefined;
        } finally {
          if (stmt) try { stmt.free(); } catch (e) {}
        }
      },
      all(...params) {
        self._checkClosed();
        let stmt;
        try {
          const results = [];
          stmt = self._db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
            results.push(row);
          }
          return results;
        } catch (e) {
          return [];
        } finally {
          if (stmt) try { stmt.free(); } catch (e) {}
        }
      },
      run(...params) {
        self._checkClosed();
        self._db.run(sql, params);
        // IMPORTANT: Capture these BEFORE _queueSave(), because
        // db.export() inside _flushSave() resets last_insert_rowid
        // and getRowsModified to 0.
        let lastId = 0;
        try {
          const r = self._db.exec('SELECT last_insert_rowid() as id');
          if (r.length > 0) lastId = Number(r[0].values[0][0]);
        } catch (e) {}
        let changes = 0;
        try {
          changes = self._db.getRowsModified();
        } catch (e) {}
        self._queueSave();
        return { lastInsertRowid: lastId, changes };
      }
    };
  }

  close() {
    this._flushSave();
    if (!this._closed) {
      this._db.close();
      this._closed = true;
    }
  }

  _queueSave() {
    this._needsSave = true;
    if (!this._filePath) return;
    this._flushSave();
  }

  _flushSave() {
    if (!this._filePath || this._closed || !this._needsSave) return;
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
      // Write to temp file first, then rename — atomic on disk
      const tmpPath = this._filePath + '.tmp';
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this._filePath);
      this._needsSave = false;
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }
};
