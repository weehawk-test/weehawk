/** Mirrors API `OrgDataChangedPayload` for browser `CustomEvent` detail. */
export type OrgDataChangedDetail = {
  entity?: string;
  action?: string;
  publicId?: string | null;
  resourceId?: number;
};

export const ORG_DATA_CHANGED_EVENT = "weehawk:org-data-changed";
