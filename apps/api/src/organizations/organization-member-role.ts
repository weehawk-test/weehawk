export const ORGANIZATION_MEMBER_ROLE = {
  OWNER: 'owner',
  MEMBER: 'member',
} as const;

export type OrganizationMemberRole =
  (typeof ORGANIZATION_MEMBER_ROLE)[keyof typeof ORGANIZATION_MEMBER_ROLE];

export function isOrganizationMemberRole(raw: unknown): raw is OrganizationMemberRole {
  return raw === ORGANIZATION_MEMBER_ROLE.OWNER || raw === ORGANIZATION_MEMBER_ROLE.MEMBER;
}
