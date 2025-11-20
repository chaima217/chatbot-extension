import sqlite3

def get_connection():
    conn = sqlite3.connect("chat_history.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def create_table():
    conn = get_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            query TEXT NOT NULL,
            response TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()
