import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 4096;

function getImageDetails(data: Buffer): { mime: "image/jpeg" | "image/png"; width: number; height: number } | null {
  const isPng = data.length >= 24
    && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && data.toString("ascii", 12, 16) === "IHDR";
  if (isPng) {
    return {
      mime: "image/png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }

  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) {
    return null;
  }

  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) return null;
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return null;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        mime: "image/jpeg",
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isValidDimensions(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width <= MAX_PHOTO_DIMENSION && height <= MAX_PHOTO_DIMENSION;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return new Response("Authentication required.", { status: 401 });

  try {
    const photo = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ profile_photo_data: Buffer; profile_photo_mime: string }>(
        "SELECT profile_photo_data, profile_photo_mime FROM users WHERE id = $1 AND profile_photo_data IS NOT NULL",
        [actor.id],
      );
      return result.rows[0] ?? null;
    });
    if (!photo) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

    return new Response(Uint8Array.from(photo.profile_photo_data), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(photo.profile_photo_data.length),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": photo.profile_photo_mime,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unable to load profile photo.", error);
    return NextResponse.json({ error: "Unable to load profile photo." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "The image must be no larger than 2 MB." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Select a valid JPEG or PNG image." }, { status: 400 });
  }
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "Select a valid JPEG or PNG image." }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "The image must be no larger than 2 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await photo.arrayBuffer());
  const details = getImageDetails(bytes);
  if (!details || !isValidDimensions(details.width, details.height) || (photo.type && photo.type !== details.mime)) {
    return NextResponse.json({ error: "Use a valid JPEG or PNG image up to 4096 × 4096 pixels." }, { status: 400 });
  }

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      await client.query(
        "UPDATE users SET profile_photo_data = $1, profile_photo_mime = $2 WHERE id = $3",
        [bytes, details.mime, actor.id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to save profile photo.", error);
    return NextResponse.json({ error: "Unable to save profile photo." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      await client.query(
        "UPDATE users SET profile_photo_data = NULL, profile_photo_mime = NULL WHERE id = $1",
        [actor.id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to remove profile photo.", error);
    return NextResponse.json({ error: "Unable to remove profile photo." }, { status: 500 });
  }
}
