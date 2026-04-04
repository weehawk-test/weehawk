import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marker for routes that skip global auth (if you add a global JWT guard later). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
