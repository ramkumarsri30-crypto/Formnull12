/**
 * FormNull — Button
 * =====================================================================
 * Extends the shadcn/ui Button with Memphis variants:
 *   - "memphis": bold ink button with offset shadow
 *   - "memphis-coral": coral button with offset ink shadow
 *   - "memphis-outline": bordered button with playful offset shadow on hover
 *
 * All variants preserve the accessibility, focus-ring, and disabled-state
 * behavior of the base Button.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline:
          "border-2 border-foreground/15 bg-transparent hover:bg-accent/10 hover:border-foreground/25 text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
        ghost: "hover:bg-accent/10 hover:text-foreground text-foreground/80",
        link: "text-primary underline-offset-4 hover:underline",
        // Memphis variants
        memphis:
          "bg-primary text-primary-foreground border-2 border-primary shadow-[4px_4px_0_0_var(--memphis-ink)] hover:shadow-[2px_2px_0_0_var(--memphis-ink)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        "memphis-coral":
          "bg-[color:var(--memphis-coral)] text-white border-2 border-[color:var(--memphis-coral)] shadow-[4px_4px_0_0_var(--memphis-ink)] hover:shadow-[2px_2px_0_0_var(--memphis-ink)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        "memphis-mint":
          "bg-[color:var(--memphis-mint)] text-[color:var(--memphis-ink)] border-2 border-[color:var(--memphis-mint)] shadow-[4px_4px_0_0_var(--memphis-ink)] hover:shadow-[2px_2px_0_0_var(--memphis-ink)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        "memphis-outline":
          "bg-transparent text-foreground border-2 border-foreground shadow-[4px_4px_0_0_var(--memphis-ink)] hover:shadow-[2px_2px_0_0_var(--memphis-ink)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-4 text-xs rounded-md",
        lg: "h-12 px-7 text-base rounded-xl",
        xl: "h-14 px-8 text-lg rounded-xl",
        icon: "h-10 w-10",
        "icon-sm": "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
