import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const labelVariants = cva("block text-[11px] font-medium text-text-3", {
  variants: {
    size: {
      default: "text-[11px]",
      sm: "text-[10.5px]",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>, VariantProps<typeof labelVariants> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, size, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants({ size, className }))} {...props} />
  ),
);
Label.displayName = "Label";

export { Label };
