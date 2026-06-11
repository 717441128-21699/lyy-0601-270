import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

interface Match {
  id: string;
  tournament_id: string;
  round_id: string;
  room_id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  notes: string | null;
  created_at: string;
}

interface MatchPlayer {
  id: string;
  match_id: string;
  player_id: string;
  seat_number: number;
  rank: number | null;
  score: number;
  tiebreaker: number;
  is_winner: number;
  created_at: string;
}

interface Penalty {
  id: string;
  tournament_id: string;
  player_id: string;
  match_id: string | null;
  round_id: string | null;
  penalty_type: string;
  reason: string | null;
  points_deducted: number;
  issued_by: string;
  issued_at: string;
  notes: string | null;
}

interface CountResult {
  count: number;
}

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, round_id, room_id, player_ids } = req.body;

  if (!tournament_id || !round_id || !room_id || !Array.isArray(player_ids) || player_ids.length === 0) {
    return res.status(400).json(errorResponse('缺少必要参数'));
  }

  const db = getDb();
  const matchId = generateId();
  const createdAt = now();

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO matches (id, tournament_id, round_id, room_id, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(matchId, tournament_id, round_id, room_id, createdAt);

    const insertPlayer = db.prepare(`
      INSERT INTO match_players (id, match_id, player_id, seat_number, score, tiebreaker, is_winner, created_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, ?)
    `);

    player_ids.forEach((player_id: string, index: number) => {
      const playerMatchId = generateId();
      insertPlayer.run(playerMatchId, matchId, player_id, index + 1, createdAt);
    });
  });

  try {
    transaction();
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as Match;
    const players = db.prepare('SELECT * FROM match_players WHERE match_id = ?').all(matchId) as MatchPlayer[];
    res.json(successResponse({ ...match, players }, '创建成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse('创建对局失败: ' + err.message));
  }
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, round_id, room_id, status, page, pageSize } = req.query;
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const conditions: string[] = [];
  const params: any[] = [];

  if (tournament_id) {
    conditions.push('tournament_id = ?');
    params.push(tournament_id);
  }
  if (round_id) {
    conditions.push('round_id = ?');
    params.push(round_id);
  }
  if (room_id) {
    conditions.push('room_id = ?');
    params.push(room_id);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as count FROM matches ${whereClause}`).get(...params) as CountResult).count;
  const list = db.prepare(`SELECT * FROM matches ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Match[];

  res.json(successResponse({ list, total, page: Number(page) || 1, pageSize: limit }));
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }

  const players = db.prepare(`
    SELECT mp.*, p.name, p.phone, p.avatar
    FROM match_players mp
    LEFT JOIN players p ON mp.player_id = p.id
    WHERE mp.match_id = ?
    ORDER BY mp.seat_number ASC
  `).all(id) as any[];

  const penalties = db.prepare('SELECT * FROM penalties WHERE match_id = ?').all(id) as Penalty[];

  res.json(successResponse({ ...match, players, penalties }));
});

router.put('/:id/start', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }
  if (match.status !== 'pending') {
    return res.status(400).json(errorResponse('只有待开始的对局才能开局'));
  }

  db.prepare(`
    UPDATE matches SET status = 'playing', started_at = ? WHERE id = ?
  `).run(now(), id);

  const updatedMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match;
  res.json(successResponse(updatedMatch, '开局成功'));
});

router.put('/:id/submit', (req: Request, res: Response) => {
  const { id } = req.params;
  const { results, submitted_by } = req.body;

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json(errorResponse('缺少比赛结果'));
  }

  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }
  if (match.status === 'submitted' || match.status === 'confirmed') {
    return res.status(400).json(errorResponse('该对局已提交结果，请勿重复提交'));
  }
  if (match.status !== 'playing') {
    return res.status(400).json(errorResponse('只有进行中的对局才能提交结果'));
  }

  const matchPlayers = db.prepare('SELECT player_id FROM match_players WHERE match_id = ?').all(id) as { player_id: string }[];
  const matchPlayerIds = matchPlayers.map((mp) => mp.player_id);

  for (const result of results) {
    if (!matchPlayerIds.includes(result.player_id)) {
      return res.status(400).json(errorResponse(`选手 ${result.player_id} 不在本场对局中`));
    }
  }

  const transaction = db.transaction(() => {
    const updatePlayer = db.prepare(`
      UPDATE match_players
      SET score = ?, rank = ?, tiebreaker = ?, is_winner = ?
      WHERE match_id = ? AND player_id = ?
    `);

    for (const result of results) {
      updatePlayer.run(
        result.score ?? 0,
        result.rank ?? null,
        result.tiebreaker ?? 0,
        result.is_winner ? 1 : 0,
        id,
        result.player_id
      );
    }

    db.prepare(`
      UPDATE matches
      SET status = 'submitted', ended_at = ?, submitted_by = ?, submitted_at = ?
      WHERE id = ?
    `).run(now(), submitted_by || null, now(), id);
  });

  try {
    transaction();
    const updatedMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match;
    const players = db.prepare('SELECT * FROM match_players WHERE match_id = ?').all(id) as MatchPlayer[];
    res.json(successResponse({ ...updatedMatch, players }, '提交成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse('提交结果失败: ' + err.message));
  }
});

router.put('/:id/confirm', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }
  if (match.status !== 'submitted') {
    return res.status(400).json(errorResponse('只有已提交的对局才能确认'));
  }

  db.prepare(`UPDATE matches SET status = 'confirmed' WHERE id = ?`).run(id);

  const updatedMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match;
  const players = db.prepare('SELECT * FROM match_players WHERE match_id = ?').all(id) as MatchPlayer[];
  res.json(successResponse({ ...updatedMatch, players }, '确认成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }

  db.prepare('UPDATE matches SET notes = ? WHERE id = ?').run(notes || null, id);

  const updatedMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match;
  res.json(successResponse(updatedMatch, '更新成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }

  db.prepare('DELETE FROM matches WHERE id = ?').run(id);
  res.json(successResponse(null, '删除成功'));
});

router.post('/:id/penalty', (req: Request, res: Response) => {
  const { id } = req.params;
  const { player_id, penalty_type, reason, points_deducted, issued_by, notes } = req.body;

  if (!player_id || !penalty_type || !issued_by) {
    return res.status(400).json(errorResponse('缺少必要参数'));
  }

  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }

  const matchPlayer = db.prepare('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?').get(id, player_id) as MatchPlayer | undefined;
  if (!matchPlayer) {
    return res.status(400).json(errorResponse('该选手不在本场对局中'));
  }

  const penaltyId = generateId();
  const issuedAt = now();

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO penalties (id, tournament_id, player_id, match_id, round_id, penalty_type, reason, points_deducted, issued_by, issued_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      penaltyId,
      match.tournament_id,
      player_id,
      id,
      match.round_id,
      penalty_type,
      reason || null,
      points_deducted || 0,
      issued_by,
      issuedAt,
      notes || null
    );

    if (points_deducted && points_deducted > 0) {
      db.prepare(`
        UPDATE match_players SET score = score - ? WHERE match_id = ? AND player_id = ?
      `).run(points_deducted, id, player_id);
    }
  });

  try {
    transaction();
    const penalty = db.prepare('SELECT * FROM penalties WHERE id = ?').get(penaltyId) as Penalty;
    res.json(successResponse(penalty, '处罚记录成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse('记录处罚失败: ' + err.message));
  }
});

export default router;
