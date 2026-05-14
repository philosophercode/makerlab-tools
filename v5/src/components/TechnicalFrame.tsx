import type { ReactNode } from "react";

interface TechnicalFrameProps {
  children: ReactNode;
  className?: string;
}

export function TechnicalFrame({ children, className = "" }: TechnicalFrameProps) {
  return (
    <div className={`technical-frame ${className}`}>
      <span className="corner corner-nw" aria-hidden="true" />
      <span className="corner corner-ne" aria-hidden="true" />
      <span className="corner corner-sw" aria-hidden="true" />
      <span className="corner corner-se" aria-hidden="true" />
      {children}
    </div>
  );
}
