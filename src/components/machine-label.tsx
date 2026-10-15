import { qrSvg } from "@/lib/qr";

export interface LabelMachine {
  id: string;
  name: string;
  manufacturer: string;
  model_number: string;
  serial_number: string;
  asset_number: string | null;
  location: string | null;
  url: string;
}

/**
 * One printable label: QR on the left, human-readable details on the right (so it still works if the code is damaged).
 * The SVG comes from the qrcode library for our own URL, so injecting it as markup is safe.
 */
export async function MachineLabel({ machine }: { machine: LabelMachine }) {
  const svg = await qrSvg(machine.url);
  return (
    <figure
      className="flex w-[92mm] break-inside-avoid items-center gap-3 rounded-lg border border-black/30 bg-white p-3 text-black"
      data-testid="machine-label"
      data-qr-url={machine.url}
    >
      <div
        role="img"
        aria-label={`QR code linking to ${machine.name}`}
        className="size-[30mm] shrink-0 [&>svg]:size-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="min-w-0 space-y-0.5 text-[11px] leading-tight">
        <div className="text-[13px] font-bold leading-snug">{machine.name}</div>
        <div>{machine.manufacturer} {machine.model_number}</div>
        <div className="font-mono">S/N {machine.serial_number}</div>
        {machine.asset_number && <div className="font-mono">Asset {machine.asset_number}</div>}
        {machine.location && <div>{machine.location}</div>}
        <div className="break-all pt-1 font-mono text-[8px] text-black/60">{machine.url.replace(/^https?:\/\//, "")}</div>
      </figcaption>
    </figure>
  );
}
