import { getCurrentUser } from "@/lib/current-user";
import { getProfile, updateSpecialty } from "@/lib/profile";
import { jsonError, readJsonObject } from "@/lib/api";
import { SPECIALTY_MAX_LENGTH } from "@/lib/definitions";
import { AR } from "@/lib/messages";
import { arServerError, arUnauthorized } from "@/lib/handlers/parent";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return arUnauthorized();
    }

    return Response.json(await getProfile(user));
  } catch (error) {
    return arServerError(error);
  }
}

// PATCH /api/profile -> { "specialty": "..." } ONLY.
// role, department, email, name or user id in the body are rejected, so a
// forged request cannot change authorization data.
export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return arUnauthorized();
    }

    const body = await readJsonObject(request);

    if (!body || !("specialty" in body)) {
      return jsonError(AR.invalidRequest, 400);
    }

    if (Object.keys(body).some((key) => key !== "specialty")) {
      return jsonError(AR.profileReadOnlyField, 400);
    }

    if (body.specialty !== null && typeof body.specialty !== "string") {
      return jsonError(AR.invalidRequest, 400);
    }

    const specialty = (body.specialty ?? "").trim();

    if (specialty.length > SPECIALTY_MAX_LENGTH) {
      return jsonError(AR.specialtyTooLong, 400);
    }

    // Always the signed-in user's own row.
    await updateSpecialty(user.id, specialty || null);

    return Response.json(await getProfile(user));
  } catch (error) {
    return arServerError(error, AR.profileFailed);
  }
}
