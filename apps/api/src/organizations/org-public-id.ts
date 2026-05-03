import { BadRequestException } from '@nestjs/common';
import { isLikelyNumericId } from '../common/public-id';

const ORG_PREFIX = 'org_';
const RANDOM_SEGMENT_LEN = 12;

/**
 * Validates `organizations.publicId` route/query values before any DB lookup.
 * Rejects numeric IDs and malformed strings to reduce IDOR probing surface.
 */
export function parseOrganizationPublicIdParam(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new BadRequestException('Organization publicId is required');
  if (isLikelyNumericId(s)) {
    throw new BadRequestException(
      'Numeric organization id is not allowed. Use publicId.',
    );
  }
  if (!s.startsWith(ORG_PREFIX)) {
    throw new BadRequestException('Invalid organization publicId format');
  }
  const rest = s.slice(ORG_PREFIX.length);
  if (
    rest.length !== RANDOM_SEGMENT_LEN ||
    !/^[0-9a-zA-Z]+$/.test(rest)
  ) {
    throw new BadRequestException('Invalid organization publicId format');
  }
  return s;
}
