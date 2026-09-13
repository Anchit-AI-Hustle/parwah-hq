// The same question the guard asks, for routes that look a member up inside
// a branch rather than once at the top: is this membership the caller's?
//
// A bare `select ... from members where id = $memberId` only ever proved the
// UUID belonged to the CIRCLE. Every member is shown every other member's
// UUID, so on its own it proved nothing about who was calling.
//
// Returns rows, so it drops into the place the query used to sit: [] when
// the membership is not the caller's, which the existing "not a member"
// branch already handles.
import { sessionUser, AUTH_REQUIRED } from './_db.mjs';

export async function ownedMember(sql, circleId, memberId, token, cols) {
  const rows = await sql`select id, name, role, phone, place, country, relation, dob, user_id
                         from members where id = ${memberId} and circle_id = ${circleId}`;
  if (!rows[0]) return [];
  if (AUTH_REQUIRED) {
    const u = await sessionUser(sql, token);
    if (!u) return [];
    if (rows[0].user_id && rows[0].user_id !== u.user_id) return [];
  }
  return rows;
}
