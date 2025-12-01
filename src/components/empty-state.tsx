import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-8",
        className
      )}
    >
      <Icon className="w-12 h-12 text-muted-foreground mb-4" />
      <h3 className="text-[17px] font-semibold text-foreground mb-2">
        {title}
      </h3>
      <p className="text-[15px] text-muted-foreground text-center max-w-sm">
        {message}
      </p>
      {action && (
        <Button
          onClick={action.onClick}
          variant="outline"
          className="mt-6 font-medium"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
