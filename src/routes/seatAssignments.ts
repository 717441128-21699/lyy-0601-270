import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, shuffleArray } from '../utils';

const router = Router();

interface SeatAssignment {
  id: string;
  tournament_id: string;
  round_id: string;
  room_id: string;
  player_id: string;
  seat_number: number;
  created_at: string;
}

router.post('/generate', (req: Request, res: Response) => {
  const { tournament_id, round_id, mode = 'random', group_id } = req.body;

  if (!tournament_id || !round_id) {
    return res.status(400).json(errorResponse('tournament_id 和 round_id 为必填字段', 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const round = db.prepare('SELECT id, round_number FROM rounds WHERE id = ? AND tournament_id = ?').get(round_id, tournament_id);
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在或不属于该赛事', 404));
  }

  const rooms = db.prepare(`
    SELECT * FROM rooms
    WHERE tournament_id = ? AND status = 'available'
    ORDER BY created_at ASC
  `).all(tournament_id) as any[];

  if (rooms.length === 0) {
    return res.status(400).json(errorResponse('没有可用的房间', 400));
  }

  let playerQuery = `
    SELECT * FROM players
    WHERE tournament_id = ? AND status IN ('registered', 'active')
  `;
  const playerParams: any[] = [tournament_id];

  if (group_id) {
    playerQuery += ' AND group_id = ?';
    playerParams.push(group_id);
  }

  playerQuery += ' ORDER BY COALESCE(seed, 999999) ASC, created_at ASC';

  let players = db.prepare(playerQuery).all(...playerParams) as any[];

  if (players.length === 0) {
    return res.status(400).json(errorResponse('没有可分配的选手', 400));
  }

  const totalCapacity = rooms.reduce((sum: number, room: any) => sum + room.capacity, 0);
  if (players.length > totalCapacity) {
    return res.status(400).json(errorResponse(`选手数量(${players.length})超出房间总容量(${totalCapacity})`, 400));
  }

  if (mode === 'random') {
    players = shuffleArray(players);
  } else if (mode === 'swiss') {
    const standings = db.prepare(`
      SELECT player_id, total_score, wins, tiebreaker_score
      FROM standings
      WHERE tournament_id = ?
      ORDER BY total_score DESC, wins DESC, tiebreaker_score DESC
    `).all(tournament_id) as any[];

    const standingMap = new Map(standings.map((s: any) => [s.player_id, s]));

    players.sort((a: any, b: any) => {
      const sa = standingMap.get(a.id);
      const sb = standingMap.get(b.id);

      if (sa && sb) {
        if (sb.total_score !== sa.total_score) return sb.total_score - sa.total_score;
        if (sb.wins !== sa.wins) return sb.wins - sa.wins;
        return sb.tiebreaker_score - sa.tiebreaker_score;
      }
      if (sa) return -1;
      if (sb) return 1;
      return 0;
    });
  }

  const deleteExisting = db.prepare('DELETE FROM seat_assignments WHERE tournament_id = ? AND round_id = ?');
  deleteExisting.run(tournament_id, round_id);

  const insertStmt = db.prepare(`
    INSERT INTO seat_assignments (id, tournament_id, round_id, room_id, player_id, seat_number, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const assignments: SeatAssignment[] = [];
  let playerIndex = 0;
  const createdAt = now();

  const generateSeatNumbers = (capacity: number): number[] => {
    const seats = [];
    for (let i = 1; i <= capacity; i++) {
      seats.push(i);
    }
    return seats;
  };

  for (const room of rooms) {
    if (playerIndex >= players.length) break;

    const seats = generateSeatNumbers(room.capacity);
    const shuffledSeats = mode === 'random' ? shuffleArray(seats) : seats;

    for (let i = 0; i < room.capacity && playerIndex < players.length; i++) {
      const player = players[playerIndex];
      const seatNumber = shuffledSeats[i];
      const assignmentId = generateId();

      insertStmt.run(
        assignmentId,
        tournament_id,
        round_id,
        room.id,
        player.id,
        seatNumber,
        createdAt
      );

      const assignment = db.prepare('SELECT * FROM seat_assignments WHERE id = ?').get(assignmentId) as SeatAssignment;
      assignments.push(assignment);

      playerIndex++;
    }
  }

  const assignmentsByRoom = rooms.map((room: any) => {
    const roomAssignments = assignments
      .filter(a => a.room_id === room.id)
      .map(a => ({
        ...a,
        player: players.find((p: any) => p.id === a.player_id)
      }))
      .sort((a, b) => a.seat_number - b.seat_number);

    return {
      room_id: room.id,
      room_name: room.name,
      capacity: room.capacity,
      seats: roomAssignments
    };
  });

  res.json(successResponse({
    total_players: players.length,
    total_rooms: rooms.length,
    assignments: assignmentsByRoom
  }, '座位分配生成成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, round_id, room_id } = req.query;

  if (!tournament_id || !round_id) {
    return res.status(400).json(errorResponse('tournament_id 和 round_id 为必填参数', 400));
  }

  const db = getDb();

  let whereSql = 'WHERE sa.tournament_id = ? AND sa.round_id = ?';
  const params: any[] = [tournament_id, round_id];

  if (room_id) {
    whereSql += ' AND sa.room_id = ?';
    params.push(room_id);
  }

  const assignments = db.prepare(`
    SELECT sa.*, p.name as player_name, r.name as room_name
    FROM seat_assignments sa
    LEFT JOIN players p ON sa.player_id = p.id
    LEFT JOIN rooms r ON sa.room_id = r.id
    ${whereSql}
    ORDER BY r.name ASC, sa.seat_number ASC
  `).all(...params);

  res.json(successResponse(assignments, '查询成功'));
});

export default router;
