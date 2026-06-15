-- Tide Database Schema
-- Run this schema against Cloudflare D1 to set up tables.

DROP TABLE IF EXISTS integrations;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS login_tokens;
DROP TABLE IF EXISTS users;

-- 1. Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Login verification tokens (magic links)
CREATE TABLE login_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Permanent User Sessions
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. User Integrations credentials (encrypted tokens stored here)
CREATE TABLE integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    jira_site TEXT,
    jira_email TEXT,
    jira_token TEXT,
    jira_project TEXT,
    jira_board_id TEXT,
    jira_points_field TEXT,
    figma_token TEXT,
    figma_files TEXT,
    clickup_token TEXT,
    clickup_team TEXT,
    slack_token TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
