export type OrganizationPublic = {
  publicId: string;
  name: string;
  isOwner: boolean;
  createdAt: string;
};

export type CreateOrganizationInput = {
  name: string;
};

export type OrganizationMemberPublic = {
  email: string;
  firstName: string;
  lastName: string;
  isOwner: boolean;
  joinedAt: string;
};

export type OrganizationProjectListItem = {
  publicId: string;
  name: string;
  description: string;
  createdAt: string;
  serviceCount: number;
};
