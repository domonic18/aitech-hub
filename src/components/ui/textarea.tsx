import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-sm text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
