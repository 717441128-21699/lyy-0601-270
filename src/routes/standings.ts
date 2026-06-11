import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

const router = Router();

interface PlayerStats {
  player_id: string;
  player_name: string;
  total_score: number;
  wins: number;
  losses: number;
  draws: number;
  matches_played: number;
  tiebreaker_score: number;
  opponents: Set<string>;
}

router.post('/refresh', (req: Request, res: Response) => {
  const { tournament_id, group_id } = req.body;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('缺少 tournament_id 参数', 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const playerWhereClause = group_id ? 'AND p.group_id = ?' : '';
  const playerParams = group_id ? [tournament_id, group_id] : [tournament_id];

  const players = db.prepare(`
    SELECT p.id, p.name
    FROM players p
    WHERE p.tournament_id = ? AND p.status NOT IN ('withdrew', 'disqualified') ${playerWhereClause}
  `).all(...playerParams) as { id: string; name: string }[];

  if (players.length === 0) {
    return res.status(400).json(errorResponse('没有找到选手', 400));
  }

  const playerIds = players.map(p => p.id);

  const matchWhereClause = group_id
    ? `AND m.id IN (SELECT mp.match_id FROM match_players mp JOIN players p ON mp.player_id = p.id WHERE p.group_id = ?)`
    : '';
  const matchParams = group_id ? [tournament_id, group_id] : [tournament_id];

  const matches = db.prepare(`
    SELECT m.id, m.status
    FROM matches m
    WHERE m.tournament_id = ? AND m.status = 'confirmed' ${matchWhereClause}
  `).all(...matchParams) as { id: string; status: string }[];

  const statsMap = new Map<string, PlayerStats>();

  for (const player of players) {
    statsMap.set(player.id, {
      player_id: player.id,
      player_name: player.name,
      total_score: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      matches_played: 0,
      tiebreaker_score: 0,
      opponents: new Set<string>(),
    });
  }

  for (const match of matches) {
    const matchPlayers = db.prepare(`
      SELECT player_id, score, tiebreaker, is_winner
      FROM match_players
      WHERE match_id = ?
    `).all(match.id) as { player_id: string; score: number; tiebreaker: number; is_winner: number }[];

    const matchPlayerIds = matchPlayers.map(mp => mp.player_id);

    for (const mp of matchPlayers) {
      const stats = statsMap.get(mp.player_id);
      if (!stats) continue;

      stats.total_score += mp.score;
      stats.tiebreaker_score += mp.tiebreaker;
      stats.matches_played += 1;

      if (mp.is_winner === 1) {
        stats.wins += 1;
      } else if (mp.is_winner === 0 && matchPlayers.some(p => p.is_winner === 1)) {
        stats.losses += 1;
      } else {
        stats.draws += 1;
      }

      for (const opponentId of matchPlayerIds) {
        if (opponentId !== mp.player_id && playerIds.includes(opponentId)) {
          stats.opponents.add(opponentId);
        }
      }
    }
  }

  let standingsList = Array.from(statsMap.values());

  for (const stats of standingsList) {
    let opponentsScore = 0;
    for (const opponentId of stats.opponents) {
      const opponentStats = statsMap.get(opponentId);
      if (opponentStats) {
        opponentsScore += opponentStats.total_score;
      }
    }
    (stats as any).opponents_score = opponentsScore;
  }

  standingsList.sort((a, b) => {
    if (b.total_score !== a.total_score) {
      return b.total_score - a.total_score;
    }
    if ((b as any).opponents_score !== (a as any).opponents_score) {
      return (b as any).opponents_score - (a as any).opponents_score;
    }
    return b.tiebreaker_score - a.tiebreaker_score;
  });

  const deleteStmt = db.prepare(`
    DELETE FROM standings
    WHERE tournament_id = ? ${group_id ? 'AND player_id IN (SELECT id FROM players WHERE group_id = ?)' : ''}
  `);
  if (group_id) {
    deleteStmt.run(tournament_id, group_id);
  } else {
    deleteStmt.run(tournament_id);
  }

  const insertStmt = db.prepare(`
    INSERT INTO standings (
      id, tournament_id, player_id, total_score, wins, losses, draws,
      matches_played, tiebreaker_score, opponents_score, rank, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    standingsList.forEach((stats, index) => {
      insertStmt.run(
        generateId(),
        tournament_id,
        stats.player_id,
        stats.total_score,
        stats.wins,
        stats.losses,
        stats.draws,
        stats.matches_played,
        stats.tiebreaker_score,
        (stats as any).opponents_score,
        index + 1,
        now()
      );
    });
  });

  transaction();

  res.json(successResponse({
    total: standingsList.length,
    refreshed_at: now(),
  }, '排行榜刷新成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, group_id, page = 1, pageSize = 20 } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('缺少 tournament_id 参数', 400));
  }

  const db = getDb();
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const whereConditions = ['s.tournament_id = ?', "p.status NOT IN ('withdrew', 'disqualified')"];
  const params: any[] = [tournament_id];

  if (group_id) {
    whereConditions.push('p.group_id = ?');
    params.push(group_id);
  }

  const whereClause = whereConditions.join(' AND ');

  const countResult = db.prepare(`
    SELECT COUNT(*) as total
    FROM standings s
    JOIN players p ON s.player_id = p.id
    WHERE ${whereClause}
  `).get(...params) as { total: number };

  const standings = db.prepare(`
    SELECT 
      s.rank,
      s.player_id,
      p.name as player_name,
      s.total_score,
      s.wins,
      s.losses,
      s.draws,
      s.matches_played,
      s.tiebreaker_score,
      s.opponents_score,
      s.updated_at
    FROM standings s
    JOIN players p ON s.player_id = p.id
    WHERE ${whereClause}
    ORDER BY s.rank ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json(successResponse({
    list: standings,
    total: countResult.total,
    page: Number(page),
    pageSize: limit,
    totalPages: Math.ceil(countResult.total / limit),
  }, '查询成功'));
});

router.get('/big-screen', (req: Request, res: Response) => {
  const { tournament_id, group_id, limit = 10 } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('缺少 tournament_id 参数', 400));
  }

  const db = getDb();
  const displayLimit = Math.min(Number(limit), 100);

  const whereConditions = ['s.tournament_id = ?', "p.status NOT IN ('withdrew', 'disqualified')"];
  const params: any[] = [tournament_id];

  if (group_id) {
    whereConditions.push('p.group_id = ?');
    params.push(group_id);
  }

  const whereClause = whereConditions.join(' AND ');

  const standings = db.prepare(`
    SELECT 
      s.rank,
      p.name as player_name,
      s.total_score,
      s.wins,
      s.losses,
      s.draws,
      s.matches_played,
      s.tiebreaker_score,
      s.opponents_score
    FROM standings s
    JOIN players p ON s.player_id = p.id
    WHERE ${whereClause}
    ORDER BY s.rank ASC
    LIMIT ?
  `).all(...params, displayLimit);

  const tournament = db.prepare('SELECT name FROM tournaments WHERE id = ?').get(tournament_id) as { name: string };

  res.json(successResponse({
    tournament_name: tournament?.name || '',
    standings,
    display_count: standings.length,
    updated_at: now(),
  }));
});

router.get('/tiebreaker-details', (req: Request, res: Response) => {
  const { tournament_id, player1_id, player2_id } = req.query;

  if (!tournament_id || !player1_id || !player2_id) {
    return res.status(400).json(errorResponse('缺少必要参数: tournament_id, player1_id, player2_id', 400));
  }

  const db = getDb();

  const player1 = db.prepare('SELECT name FROM players WHERE id = ? AND tournament_id = ?').get(player1_id, tournament_id);
  const player2 = db.prepare('SELECT name FROM players WHERE id = ? AND tournament_id = ?').get(player2_id, tournament_id);

  if (!player1 || !player2) {
    return res.status(404).json(errorResponse('选手不存在', 404));
  }

  const matches = db.prepare(`
    SELECT 
      m.id,
      m.status,
      r.round_number,
      m.started_at,
      m.ended_at
    FROM matches m
    JOIN rounds r ON m.round_id = r.id
    WHERE m.tournament_id = ?
      AND m.status = 'confirmed'
      AND m.id IN (
        SELECT match_id FROM match_players WHERE player_id = ?
        INTERSECT
        SELECT match_id FROM match_players WHERE player_id = ?
      )
    ORDER BY r.round_number ASC
  `).all(tournament_id, player1_id, player2_id) as {
    id: string;
    status: string;
    round_number: number;
    started_at: string | null;
    ended_at: string | null;
  }[];

  const matchDetails = matches.map(match => {
    const players = db.prepare(`
      SELECT player_id, score, tiebreaker, is_winner, seat_number
      FROM match_players
      WHERE match_id = ? AND player_id IN (?, ?)
      ORDER BY seat_number ASC
    `).all(match.id, player1_id, player2_id) as {
      player_id: string;
      score: number;
      tiebreaker: number;
      is_winner: number;
      seat_number: number;
    }[];

    const p1Stats = players.find(p => p.player_id === player1_id);
    const p2Stats = players.find(p => p.player_id === player2_id);

    let result = 'draw';
    if (p1Stats?.is_winner === 1) result = 'player1_win';
    else if (p2Stats?.is_winner === 1) result = 'player2_win';

    return {
      match_id: match.id,
      round_number: match.round_number,
      status: match.status,
      player1: {
        id: player1_id,
        name: (player1 as any).name,
        score: p1Stats?.score || 0,
        tiebreaker: p1Stats?.tiebreaker || 0,
        is_winner: p1Stats?.is_winner === 1,
      },
      player2: {
        id: player2_id,
        name: (player2 as any).name,
        score: p2Stats?.score || 0,
        tiebreaker: p2Stats?.tiebreaker || 0,
        is_winner: p2Stats?.is_winner === 1,
      },
      result,
      played_at: match.ended_at || match.started_at,
    };
  });

  let player1Wins = 0;
  let player2Wins = 0;
  let draws = 0;

  for (const detail of matchDetails) {
    if (detail.result === 'player1_win') player1Wins++;
    else if (detail.result === 'player2_win') player2Wins++;
    else draws++;
  }

  res.json(successResponse({
    player1: { id: player1_id, name: (player1 as any).name },
    player2: { id: player2_id, name: (player2 as any).name },
    total_matches: matchDetails.length,
    player1_wins: player1Wins,
    player2_wins: player2Wins,
    draws,
    matches: matchDetails,
  }));
});

router.post('/export', (req: Request, res: Response) => {
  const { tournament_id, group_id, format = 'csv' } = req.body;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('缺少 tournament_id 参数', 400));
  }

  if (format !== 'csv') {
    return res.status(400).json(errorResponse('不支持的导出格式，仅支持 csv', 400));
  }

  const db = getDb();

  const whereConditions = ['s.tournament_id = ?', "p.status NOT IN ('withdrew', 'disqualified')"];
  const params: any[] = [tournament_id];

  if (group_id) {
    whereConditions.push('p.group_id = ?');
    params.push(group_id);
  }

  const whereClause = whereConditions.join(' AND ');

  const standings = db.prepare(`
    SELECT 
      s.rank,
      p.name as player_name,
      s.total_score,
      s.wins,
      s.losses,
      s.draws,
      s.matches_played,
      s.tiebreaker_score,
      s.opponents_score
    FROM standings s
    JOIN players p ON s.player_id = p.id
    WHERE ${whereClause}
    ORDER BY s.rank ASC
  `).all(...params) as {
    rank: number;
    player_name: string;
    total_score: number;
    wins: number;
    losses: number;
    draws: number;
    matches_played: number;
    tiebreaker_score: number;
    opponents_score: number;
  }[];

  const headers = ['排名', '选手姓名', '总积分', '胜场', '负场', '平场', '参赛场次', '小分', '对手分'];

  const csvRows = [headers.join(',')];

  for (const row of standings) {
    csvRows.push([
      row.rank,
      `"${row.player_name}"`,
      row.total_score,
      row.wins,
      row.losses,
      row.draws,
      row.matches_played,
      row.tiebreaker_score,
      row.opponents_score,
    ].join(','));
  }

  const csvContent = csvRows.join('\n');
  const bom = '\uFEFF';
  const csvWithBom = bom + csvContent;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="standings_${tournament_id}.csv"`);

  res.json(successResponse({
    format: 'csv',
    filename: `standings_${tournament_id}.csv`,
    content: csvWithBom,
    total: standings.length,
  }));
});

export default router;
