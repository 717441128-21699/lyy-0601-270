import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

interface Referee {
  id: string;
  tournament_id: string;
  name: string;
  phone: string | null;
  role: string;
  created_at: string;
}

interface RefereeDecision {
  id: string;
  tournament_id: string;
  match_id: string;
  referee_id: string;
  decision_type: string;
  previous_data: string | null;
  new_data: string | null;
  reason: string | null;
  created_at: string;
}

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

interface CountResult {
  count: number;
}

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, name, phone, role } = req.body;

  if (!tournament_id || !name) {
    return res.status(400).json(errorResponse('缺少必要参数'));
  }

  const db = getDb();
  const refereeId = generateId();
  const createdAt = now();

  db.prepare(`
    INSERT INTO referees (id, tournament_id, name, phone, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(refereeId, tournament_id, name, phone || null, role || 'referee', createdAt);

  const referee = db.prepare('SELECT * FROM referees WHERE id = ?').get(refereeId) as Referee;
  res.json(successResponse(referee, '创建成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, page, pageSize } = req.query;
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const conditions: string[] = [];
  const params: any[] = [];

  if (tournament_id) {
    conditions.push('tournament_id = ?');
    params.push(tournament_id);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as count FROM referees ${whereClause}`).get(...params) as CountResult).count;
  const list = db.prepare(`SELECT * FROM referees ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Referee[];

  res.json(successResponse({ list, total, page: Number(page) || 1, pageSize: limit }));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, phone, role } = req.body;
  const db = getDb();

  const referee = db.prepare('SELECT * FROM referees WHERE id = ?').get(id) as Referee | undefined;
  if (!referee) {
    return res.status(404).json(errorResponse('裁判不存在'));
  }

  db.prepare(`
    UPDATE referees SET name = ?, phone = ?, role = ? WHERE id = ?
  `).run(name || referee.name, phone !== undefined ? phone : referee.phone, role || referee.role, id);

  const updatedReferee = db.prepare('SELECT * FROM referees WHERE id = ?').get(id) as Referee;
  res.json(successResponse(updatedReferee, '更新成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const referee = db.prepare('SELECT * FROM referees WHERE id = ?').get(id) as Referee | undefined;
  if (!referee) {
    return res.status(404).json(errorResponse('裁判不存在'));
  }

  db.prepare('DELETE FROM referees WHERE id = ?').run(id);
  res.json(successResponse(null, '删除成功'));
});

router.post('/decisions', (req: Request, res: Response) => {
  const { match_id, referee_id, decision_type, reason, new_results } = req.body;

  if (!match_id || !referee_id || !decision_type || !Array.isArray(new_results) || new_results.length === 0) {
    return res.status(400).json(errorResponse('缺少必要参数'));
  }

  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id) as Match | undefined;
  if (!match) {
    return res.status(404).json(errorResponse('对局不存在'));
  }

  const referee = db.prepare('SELECT * FROM referees WHERE id = ?').get(referee_id) as Referee | undefined;
  if (!referee) {
    return res.status(404).json(errorResponse('裁判不存在'));
  }

  const oldMatchPlayers = db.prepare('SELECT * FROM match_players WHERE match_id = ?').all(match_id) as MatchPlayer[];
  if (oldMatchPlayers.length === 0) {
    return res.status(400).json(errorResponse('该对局没有选手数据'));
  }

  const matchPlayerIds = oldMatchPlayers.map((mp) => mp.player_id);
  for (const result of new_results) {
    if (!matchPlayerIds.includes(result.player_id)) {
      return res.status(400).json(errorResponse(`选手 ${result.player_id} 不在本场对局中`));
    }
  }

  const decisionId = generateId();
  const createdAt = now();

  const transaction = db.transaction(() => {
    const previousData = JSON.stringify(oldMatchPlayers);
    const newData = JSON.stringify(new_results);

    db.prepare(`
      INSERT INTO referee_decisions (id, tournament_id, match_id, referee_id, decision_type, previous_data, new_data, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decisionId,
      match.tournament_id,
      match_id,
      referee_id,
      decision_type,
      previousData,
      newData,
      reason || null,
      createdAt
    );

    const updatePlayer = db.prepare(`
      UPDATE match_players
      SET score = ?, rank = ?, tiebreaker = ?, is_winner = ?
      WHERE match_id = ? AND player_id = ?
    `);

    for (const result of new_results) {
      updatePlayer.run(
        result.score ?? 0,
        result.rank ?? null,
        result.tiebreaker ?? 0,
        result.is_winner ? 1 : 0,
        match_id,
        result.player_id
      );
    }
  });

  try {
    transaction();
    const decision = db.prepare('SELECT * FROM referee_decisions WHERE id = ?').get(decisionId) as RefereeDecision;
    const updatedPlayers = db.prepare('SELECT * FROM match_players WHERE match_id = ?').all(match_id) as MatchPlayer[];
    res.json(successResponse({ decision, updated_players: updatedPlayers }, '改判成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse('改判失败: ' + err.message));
  }
});

router.get('/decisions', (req: Request, res: Response) => {
  const { tournament_id, match_id, referee_id, page, pageSize } = req.query;
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const conditions: string[] = [];
  const params: any[] = [];

  if (tournament_id) {
    conditions.push('rd.tournament_id = ?');
    params.push(tournament_id);
  }
  if (match_id) {
    conditions.push('rd.match_id = ?');
    params.push(match_id);
  }
  if (referee_id) {
    conditions.push('rd.referee_id = ?');
    params.push(referee_id);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as count FROM referee_decisions rd ${whereClause}`).get(...params) as CountResult).count;
  const list = db.prepare(`
    SELECT rd.*, r.name as referee_name, m.status as match_status
    FROM referee_decisions rd
    LEFT JOIN referees r ON rd.referee_id = r.id
    LEFT JOIN matches m ON rd.match_id = m.id
    ${whereClause}
    ORDER BY rd.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  res.json(successResponse({ list, total, page: Number(page) || 1, pageSize: limit }));
});

export default router;
