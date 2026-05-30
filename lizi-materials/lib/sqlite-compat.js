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
    this._writeTimer = null;
    this._needsSave = false;

    if (filePath && fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }
  }

  pragma(str) {
    try { this._db.run(`PRAGMA ${str}`); } catch (e) {}
  }

  exec(sql) {
    this._db.exec(sql);
    this._queueSave();
  }

  prepare(sql) {
    const db = this._db;
    const self = this;
    return {
      get(...params) {
        try {
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          return undefined;
        }
      },
      all(...params) {
        try {
          const results = [];
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
            results.push(row);
          }
          stmt.free();
          return results;
        } catch (e) {
          return [];
        }
      },
      run(...params) {
        db.run(sql, params);
        self._queueSave();
        let lastId = 0;
        try {
          const r = db.exec('SELECT last_insert_rowid() as id');
          if (r.length > 0) lastId = Number(r[0].values[0][0]);
        } catch (e) {}
        let changes = 0;
        try {
          changes = db.getRowsModified();
        } catch (e) {}
        return { lastInsertRowid: lastId, changes };
      }
    };
  }

  close() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
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
      fs.writeFileSync(this._filePath, buffer);
      this._needsSave = false;
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }
};
