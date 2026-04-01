"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";

/** Alias for table bulk selection — uses the shared dark-theme checkbox styles. */
export const DockerBulkCheckbox = React.forwardRef<
  React.ElementRef<typeof Checkbox>,
  React.ComponentPropsWithoutRef<typeof Checkbox>
>((props, ref) => <Checkbox ref={ref} {...props} />);
DockerBulkCheckbox.displayName = "DockerBulkCheckbox";
