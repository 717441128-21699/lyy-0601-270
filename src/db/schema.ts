export const schemaSQL = `
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    total_rounds INTEGER NOT NULL DEFAULT 0,
    current_round INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groups_table (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    group_id TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    avatar TEXT,
    status TEXT NOT NULL DEFAULT 'registered',
    seed INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS referees (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'referee',
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'available',
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS seat_assignments (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    ended_at TEXT,
    submitted_by TEXT,
    submitted_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS match_players (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL,
    rank INTEGER,
    score REAL NOT NULL DEFAULT 0,
    tiebreaker REAL NOT NULL DEFAULT 0,
    is_winner INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS penalties (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    match_id TEXT,
    round_id TEXT,
    penalty_type TEXT NOT NULL,
    reason TEXT,
    points_deducted REAL NOT NULL DEFAULT 0,
    issued_by TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS referee_decisions (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    referee_id TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    previous_data TEXT,
    new_data TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    target_type TEXT NOT NULL DEFAULT 'all',
    target_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS substitutions (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    original_player_id TEXT NOT NULL,
    substitute_player_id TEXT,
    round_id TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (original_player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (substitute_player_id) REFERENCES players(id) ON DELETE SET NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS standings (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    total_score REAL NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    matches_played INTEGER NOT NULL DEFAULT 0,
    tiebreaker_score REAL NOT NULL DEFAULT 0,
    opponents_score REAL NOT NULL DEFAULT 0,
    rank INTEGER,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_players_tournament ON players(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
  CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room_id);
  CREATE INDEX IF NOT EXISTS idx_match_players_match ON match_players(match_id);
  CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_seat_assignments_round_room ON seat_assignments(round_id, room_id);
`;
