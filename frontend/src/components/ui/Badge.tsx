import React, { HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "primary" | "secondary" | "danger" | "warning" | "success";
}

export function Badge({ className = "", variant = "default", ...props }: BadgeProps) {
  const baseStyles = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  
  const variants = {
    default: "border-transparent bg-gray-800 text-gray-100",
    primary: "border-transparent bg-primary text-white",
    secondary: "border-transparent bg-slate-500 text-white",
    danger: "border-transparent bg-danger text-white",
    warning: "border-transparent bg-warning text-white",
    success: "border-transparent bg-success text-white",
  };
  
  const classes = `${baseStyles} ${variants[variant]} ${className}`;
  
  return <div className={classes} {...props} />;
}
