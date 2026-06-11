import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse } from '../utils';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, original_player_id, substitute_player_id, round_id, reason } = req.body;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('赛事ID不能为空', 400));
  }
  if (!original_player_id) {
    return res.status(400).json(errorResponse('原选手ID不能为空', 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const originalPlayer = db.prepare(
    'SELECT * FROM players WHERE id = ? AND tournament_id = ?'
  ).get(original_player_id, tournament_id);
  if (!originalPlayer) {
    return res.status(404).json(errorResponse('原选手不存在', 404));
  }

  if (substitute_player_id) {
    const substitutePlayer = db.prepare(
      'SELECT * FROM players WHERE id = ? AND tournament_id = ?'
    ).get(substitute_player_id, tournament_id);
    if (!substitutePlayer) {
      return res.status(404).json(errorResponse('替补选手不存在', 404));
    }
    if (original_player_id === substitute_player_id) {
      return res.status(400).json(errorResponse('原选手和替补选手不能为同一人', 400));
    }
  }

  if (round_id) {
    const round = db.prepare(
      'SELECT * FROM rounds WHERE id = ? AND tournament_id = ?'
    ).get(round_id, tournament_id);
    if (!round) {
      return res.status(404).json(errorResponse('轮次不存在', 404));
    }
  }

  const id = generateId();
  const currentTime = now();

  const stmt = db.prepare(`
    INSERT INTO substitutions (id, tournament_id, original_player_id, substitute_player_id, round_id, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  stmt.run(id, tournament_id, original_player_id, substitute_player_id || null, round_id || null, reason || null, currentTime);

  const substitution = db.prepare('SELECT * FROM substitutions WHERE id = ?').get(id);
  res.json(successResponse(substitution, '提交替补申请成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, status } = req.query;
  const db = getDb();

  let whereClauses: string[] = [];
  let params: any[] = [];

  if (tournament_id) {
    whereClauses.push('tournament_id = ?');
    params.push(tournament_id);
  }
  if (status) {
    whereClauses.push('status = ?');
    params.push(status);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const list = db.prepare(`
    SELECT * FROM substitutions ${whereSql}
    ORDER BY created_at DESC
  `).all(...params);

  res.json(successResponse(list, '查询替补记录成功'));
});

router.put('/:id/approve', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const substitution = db.prepare('SELECT * FROM substitutions WHERE id = ?').get(id) as any;
  if (!substitution) {
    return res.status(404).json(errorResponse('替补申请不存在', 404));
  }
  if (substitution.status !== 'pending') {
    return res.status(400).json(errorResponse('只有待审批的申请才能通过', 400));
  }

  const originalPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(substitution.original_player_id) as any;
  if (!originalPlayer) {
    return res.status(404).json(errorResponse('原选手不存在', 404));
  }

  let substitutePlayer = null;
  if (substitution.substitute_player_id) {
    substitutePlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(substitution.substitute_player_id);
    if (!substitutePlayer) {
      return res.status(404).json(errorResponse('替补选手不存在', 404));
    }
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE substitutions SET status = 'approved' WHERE id = ?
    `).run(id);

    db.prepare(`
      UPDATE players SET status = 'withdrew' WHERE id = ?
    `).run(substitution.original_player_id);

    if (substitution.substitute_player_id) {
      db.prepare(`
        UPDATE players SET status = 'active' WHERE id = ?
      `).run(substitution.substitute_player_id);

      db.prepare(`
        UPDATE seat_assignments SET player_id = ?
        WHERE player_id = ? AND tournament_id = ?
        ${substitution.round_id ? 'AND round_id = ?' : ''}
      `).run(
        substitution.substitute_player_id,
        substitution.original_player_id,
        substitution.tournament_id,
        ...(substitution.round_id ? [substitution.round_id] : [])
      );

      db.prepare(`
        UPDATE match_players SET player_id = ?
        WHERE player_id = ?
        AND match_id IN (SELECT id FROM matches WHERE tournament_id = ? ${substitution.round_id ? 'AND round_id = ?' : ''})
      `).run(
        substitution.substitute_player_id,
        substitution.original_player_id,
        substitution.tournament_id,
        ...(substitution.round_id ? [substitution.round_id] : [])
      );

      const originalStanding = db.prepare(
        'SELECT * FROM standings WHERE player_id = ? AND tournament_id = ?'
      ).get(substitution.original_player_id, substitution.tournament_id);

      if (originalStanding) {
        const subStanding = db.prepare(
          'SELECT * FROM standings WHERE player_id = ? AND tournament_id = ?'
        ).get(substitution.substitute_player_id, substitution.tournament_id);

        if (subStanding) {
          db.prepare(`
            UPDATE standings SET
              total_score = total_score + ?,
              wins = wins + ?,
              losses = losses + ?,
              draws = draws + ?,
              matches_played = matches_played + ?,
              tiebreaker_score = tiebreaker_score + ?,
              updated_at = ?
            WHERE player_id = ? AND tournament_id = ?
          `).run(
            (originalStanding as any).total_score,
            (originalStanding as any).wins,
            (originalStanding as any).losses,
            (originalStanding as any).draws,
            (originalStanding as any).matches_played,
            (originalStanding as any).tiebreaker_score,
            now(),
            substitution.substitute_player_id,
            substitution.tournament_id
          );

          db.prepare(
            'DELETE FROM standings WHERE player_id = ? AND tournament_id = ?'
          ).run(substitution.original_player_id, substitution.tournament_id);
        } else {
          db.prepare(`
            UPDATE standings SET player_id = ? WHERE player_id = ? AND tournament_id = ?
          `).run(
            substitution.substitute_player_id,
            substitution.original_player_id,
            substitution.tournament_id
          );
        }
      }
    } else {
      db.prepare(
        'DELETE FROM standings WHERE player_id = ? AND tournament_id = ?'
      ).run(substitution.original_player_id, substitution.tournament_id);
    }
  });

  try {
    transaction();
    const updated = db.prepare('SELECT * FROM substitutions WHERE id = ?').get(id);
    res.json(successResponse(updated, '替补申请已通过'));
  } catch (err: any) {
    res.status(500).json(errorResponse('审批失败: ' + err.message, 500));
  }
});

router.put('/:id/reject', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const substitution = db.prepare('SELECT * FROM substitutions WHERE id = ?').get(id);
  if (!substitution) {
    return res.status(404).json(errorResponse('替补申请不存在', 404));
  }
  if ((substitution as any).status !== 'pending') {
    return res.status(400).json(errorResponse('只有待审批的申请才能拒绝', 400));
  }

  db.prepare(`
    UPDATE substitutions SET status = 'rejected' WHERE id = ?
  `).run(id);

  const updated = db.prepare('SELECT * FROM substitutions WHERE id = ?').get(id);
  res.json(successResponse(updated, '替补申请已拒绝'));
});

export default router;
