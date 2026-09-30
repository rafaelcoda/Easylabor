import { DEFAULT_CONFIG, rankProfessionals, type Config } from '@diaria/core';
import type { Sql } from '../db';
import { notFound } from '../errors';

export interface SearchParams {
  category: string;
  date: string; // YYYY-MM-DD
  lat?: number;
  lng?: number;
  addressId?: string;
  clientId: string;
  limit: number;
}

export async function searchProfessionals(sql: Sql, p: SearchParams, cfg: Config = DEFAULT_CONFIG) {
  let lat = p.lat;
  let lng = p.lng;
  if (p.addressId) {
    const a = await sql`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM addresses WHERE id = ${p.addressId} AND client_id = ${p.clientId}`;
    if (!a[0]) throw notFound('Endereço');
    lat = a[0].lat as number;
    lng = a[0].lng as number;
  }
  if (lat === undefined || lng === undefined) throw new Error('lat/lng ausentes');

  const rows = await sql`
    SELECT p.user_id AS id, u.full_name, p.photo_url, p.rating_avg::float8 AS rating_avg, p.rating_count,
           p.completed_count, p.acceptance_rate::float8 AS acceptance_rate, p.attendance_rate::float8 AS attendance_rate,
           p.radius_km, o.daily_rate_cents, c.min_daily_rate_cents, c.max_daily_rate_cents,
           ST_Distance(p.base_location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m
    FROM professional_profiles p
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    JOIN service_offers o ON o.professional_id = p.user_id AND o.active
    JOIN service_categories c ON c.id = o.category_id AND c.slug = ${p.category} AND c.active
    WHERE p.kyc_status = 'approved' AND p.visible
      AND EXISTS (SELECT 1 FROM availabilities av
                  WHERE av.professional_id = p.user_id AND av.day = ${p.date}::date AND av.status = 'free')
      AND ST_DWithin(p.base_location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, p.radius_km * 1000)`;

  const ranked = rankProfessionals(
    rows.map((r) => ({
      id: r.id as string,
      distanceM: Number(r.distance_m),
      radiusM: Number(r.radius_km) * 1000,
      rating: Number(r.rating_avg ?? 0),
      // Profissional novo, sem histórico: valor neutro até haver dados.
      acceptanceRate: r.acceptance_rate === null ? 0.5 : Number(r.acceptance_rate),
      attendanceRate: r.attendance_rate === null ? 0.5 : Number(r.attendance_rate),
      dailyRateCents: Number(r.daily_rate_cents),
      minRateCents: Number(r.min_daily_rate_cents),
      maxRateCents: Number(r.max_daily_rate_cents),
      row: r,
    })),
    cfg,
  );

  return ranked.slice(0, p.limit).map((x) => ({
    professional_id: x.id,
    name: x.row.full_name as string,
    photo_url: (x.row.photo_url as string | null) ?? null,
    category: p.category,
    daily_rate_cents: x.dailyRateCents,
    rating_avg: x.rating,
    rating_count: Number(x.row.rating_count),
    completed_count: Number(x.row.completed_count),
    attendance_rate: x.attendanceRate,
    distance_m: Math.round(x.distanceM),
    score: Number(x.score.toFixed(4)),
  }));
}
