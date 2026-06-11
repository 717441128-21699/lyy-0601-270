import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

const router = Router();

interface Player {
  id: string;
  tournament_id: string;
  group_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  status: string;
  seed: number | null;
  created_at: string;
}

interface PlayerHistory {
  matches: any[];
  stats: {
    total_matches: number;
    wins: number;
    losses: number;
    draws: number;
    total_score: number;
    win_rate: number;
  };
}

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, group_id, name, phone, email, seed } = req.body;

  if (!tournament_id || !name) {
    return res.status(400).json(errorResponse('tournament_id 和 name 为必填字段', 400));
  }

  const db = getDb();
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('比赛不存在', 404));
  }

  if (group_id) {
    const group = db.prepare('SELECT id FROM groups_table WHERE id = ? AND tournament_id = ?').get(group_id, tournament_id);
    if (!group) {
      return res.status(404).json(errorResponse('分组不存在或不属于该比赛', 404));
    }
  }

  const id = generateId();
  const createdAt = now();

  db.prepare(`
    INSERT INTO players (id, tournament_id, group_id, name, phone, email, status, seed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?)
  `).run(id, tournament_id, group_id || null, name, phone || null, email || null, seed || null, createdAt);

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;

  res.status(201).json(successResponse(player, '选手创建成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, group_id, page = 1, pageSize = 20 } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('tournament_id 为必填参数', 400));
  }

  const db = getDb();
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  let whereClause = 'WHERE tournament_id = ?';
  const params: any[] = [tournament_id];

  if (group_id) {
    whereClause += ' AND group_id = ?';
    params.push(group_id);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM players ${whereClause}`).get(...params) as { count: number };

  const players = db.prepare(`
    SELECT * FROM players ${whereClause}
    ORDER BY COALESCE(seed, 999999) ASC, created_at ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Player[];

  res.json(successResponse({
    list: players,
    total: total.count,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.ceil(total.count / limit)
  }, '查询成功'));
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;

  if (!player) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }

  res.json(successResponse(player, '查询成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { group_id, name, phone, email, status, seed } = req.body;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
  if (!player) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }

  if (group_id !== undefined) {
    const group = db.prepare('SELECT id FROM groups_table WHERE id = ? AND tournament_id = ?').get(group_id, player.tournament_id);
    if (!group && group_id !== null) {
      return res.status(404).json(errorResponse('分组不存在或不属于该比赛', 404));
    }
  }

  const updatedName = name !== undefined ? name : player.name;
  const updatedPhone = phone !== undefined ? phone : player.phone;
  const updatedEmail = email !== undefined ? email : player.email;
  const updatedStatus = status !== undefined ? status : player.status;
  const updatedSeed = seed !== undefined ? seed : player.seed;
  const updatedGroupId = group_id !== undefined ? group_id : player.group_id;

  db.prepare(`
    UPDATE players
    SET group_id = ?, name = ?, phone = ?, email = ?, status = ?, seed = ?
    WHERE id = ?
  `).run(updatedGroupId, updatedName, updatedPhone, updatedEmail, updatedStatus, updatedSeed, id);

  const updatedPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;

  res.json(successResponse(updatedPlayer, '选手更新成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!player) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }

  db.prepare('DELETE FROM players WHERE id = ?').run(id);

  res.json(successResponse(null, '选手删除成功'));
});

router.post('/batch', (req: Request, res: Response) => {
  const { tournament_id, players } = req.body;

  if (!tournament_id || !Array.isArray(players) || players.length === 0) {
    return res.status(400).json(errorResponse('tournament_id 和 players 数组为必填', 400));
  }

  const db = getDb();
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('比赛不存在', 404));
  }

  const createdAt = now();
  const insertStmt = db.prepare(`
    INSERT INTO players (id, tournament_id, group_id, name, phone, email, status, seed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?)
  `);

  const createdPlayers: Player[] = [];

  const transaction = db.transaction((playerList: any[]) => {
    for (const playerData of playerList) {
      if (!playerData.name) {
        throw new Error('选手名称不能为空');
      }
      const id = generateId();
      insertStmt.run(
        id,
        tournament_id,
        playerData.group_id || null,
        playerData.name,
        playerData.phone || null,
        playerData.email || null,
        playerData.seed || null,
        createdAt
      );
      const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
      createdPlayers.push(player);
    }
  });

  try {
    transaction(players);
  } catch (err: any) {
    return res.status(400).json(errorResponse('批量创建失败: ' + err.message, 400));
  }

  res.status(201).json(successResponse({
    created: createdPlayers.length,
    players: createdPlayers
  }, '批量创建成功'));
});

router.get('/:id/history', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!player) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }

  const matchPlayers = db.prepare(`
    SELECT 
      mp.*,
      m.tournament_id,
      m.round_id,
      m.room_id,
      m.status as match_status,
      m.started_at,
      m.ended_at,
      r.round_number
    FROM match_players mp
    INNER JOIN matches m ON mp.match_id = m.id
    INNER JOIN rounds r ON m.round_id = r.id
    WHERE mp.player_id = ?
    ORDER BY r.round_number DESC, m.created_at DESC
  `).all(id) as any[];

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalScore = 0;

  for (const mp of matchPlayers) {
    totalScore += mp.score || 0;
    if (mp.is_winner === 1) {
      wins++;
    } else if (mp.match_status === 'completed') {
      losses++;
    }
  }

  const totalMatches = matchPlayers.length;
  const winRate = totalMatches > 0 ? Number(((wins / totalMatches) * 100).toFixed(2)) : 0;

  const history: PlayerHistory = {
    matches: matchPlayers,
    stats: {
      total_matches: totalMatches,
      wins,
      losses,
      draws,
      total_score: totalScore,
      win_rate: winRate
    }
  };

  res.json(successResponse(history, '查询成功'));
});

router.put('/:id/withdraw', (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
  if (!player) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }
  if (player.status === 'withdrew' || player.status === 'disqualified') {
    return res.status(400).json(errorResponse('该选手已退赛或被取消资格', 400));
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE players SET status = 'withdrew' WHERE id = ?
    `).run(id);

    const subId = generateId();
    const currentTime = now();
    db.prepare(`
      INSERT INTO substitutions (id, tournament_id, original_player_id, substitute_player_id, round_id, reason, status, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?, 'approved', ?)
    `).run(subId, player.tournament_id, id, reason || '选手主动退赛', currentTime);

    db.prepare(
      'DELETE FROM standings WHERE player_id = ? AND tournament_id = ?'
    ).run(id, player.tournament_id);
  });

  try {
    transaction();
    const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
    res.json(successResponse(updated, '选手已退赛'));
  } catch (err: any) {
    res.status(500).json(errorResponse('退赛处理失败: ' + err.message, 500));
  }
});

export default router;
