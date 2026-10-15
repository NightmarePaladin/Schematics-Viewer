"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} data-testid="print-button">
      <Printer aria-hidden /> {label}
    </Button>
  );
}
