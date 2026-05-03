import { SetMetadata } from '@nestjs/common';
import { ORG_PUBLIC_ID_PARAM_METADATA } from '../organization-request.constants';

/** Route param name holding the organization `publicId` (default: `publicId`). */
export function OrgPublicIdParam(paramName: string) {
  return SetMetadata(ORG_PUBLIC_ID_PARAM_METADATA, paramName);
}
