import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "border-line bg-panel-2 text-text-2",
        success: "border-green/40 bg-green/10 text-green-hi",
        warning: "border-amber/40 bg-amber/10 text-amber-hi",
        danger: "border-red/40 bg-red/10 text-red-hi",
        outline: "border-line text-text-3",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
