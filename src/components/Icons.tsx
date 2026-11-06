import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SelectIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l11 6-5 1.5L9 16z" />
  </Svg>
);
export const PenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16l2.5-.6L16 6l-2-2-9.4 9.5z" />
    <path d="M12.5 5.5l2 2" />
  </Svg>
);
export const BrushIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 3.5l-7 7 2 2 7-7z" />
    <path d="M9.5 10.5c-2.5-.5-4.5 1-4.5 3.5 0 1.2-.8 2-2 2.5 3 .8 6.8-.3 6.5-4" />
  </Svg>
);
export const LineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16L16 4" />
  </Svg>
);
export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16L16 4" />
    <path d="M9 4h7v7" />
  </Svg>
);
export const BoxIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="13" height="10" rx="1" />
  </Svg>
);
export const CircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="10" cy="10" rx="7" ry="5.5" />
  </Svg>
);
export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5h10M10 5v11M8 16h4" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <circle cx="7.5" cy="8.5" r="1.3" />
    <path d="M3.5 14.5l4-4 3.5 3.5 2-2 3.5 3.5" />
  </Svg>
);
export const EraserIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 16l-4.5-4.5L11 4l5.5 5.5L10 16z" />
    <path d="M7 8l5.5 5.5M8 16h9" />
  </Svg>
);
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 8h6a3.5 3.5 0 010 7H8" />
    <path d="M9.5 5L6.5 8l3 3" />
  </Svg>
);
export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H7a3.5 3.5 0 000 7h5" />
    <path d="M10.5 5l3 3-3 3" />
  </Svg>
);
export const CatchUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5l1.7 1.7 2.8-2.8M3.5 12.5l1.7 1.7 2.8-2.8M10.5 6H16.5M10.5 13H16.5" />
  </Svg>
);
export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.5}>
    <rect x="2.5" y="2.5" width="15" height="15" />
    <path d="M2.5 7.5h15M2.5 12.5h15M7.5 2.5v15M12.5 2.5v15" />
  </Svg>
);
export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8a5 5 0 0110 0c0 5 2 6 2 6H3s2-1 2-6zM8 17h4" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4v12M4 10h12" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.5 4l-6 6 6 6" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 4l6 6-6 6" />
  </Svg>
);
export const ExportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5" />
    <path d="M4 13.5V16h12v-2.5" />
  </Svg>
);
export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h4l2 2h6a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5H4a1.5 1.5 0 01-1.5-1.5z" />
  </Svg>
);

export const GripIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01"
      strokeWidth={2.6}
    />
  </Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3.5l3.5 3.5L7 16.5H3.5V13z" />
    <path d="M11 5.5l3.5 3.5" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <path d="M13 4.5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v8a1 1 0 001 1h.5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5h13M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5" />
    <path d="M5 5.5l.8 10.6a1 1 0 001 .9h6.4a1 1 0 001-.9L15 5.5M8.5 9v5M11.5 9v5" />
  </Svg>
);
export const PagesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="2.5" width="11" height="13" rx="1.5" />
    <path d="M3 5.5v10a2 2 0 002 2h8M8 6.5h5M8 9.5h5M8 12.5h3" />
  </Svg>
);

export function NotebookMark() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      stroke="var(--mint)"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="5" y="3" width="17" height="20" rx="2" />
      <path d="M3 7h4M3 11h4M3 15h4M3 19h4" />
      <path d="M11 9h7M11 13h7M11 17h4" />
    </svg>
  );
}
