export type PlatformFoundationStatus = 'ready' | 'planned';

export type PlatformFoundationStatusItem = {
  label: string;
  status: PlatformFoundationStatus;
  href?: string;
  actionLabel?: string;
};

export type PlatformFoundationViewModel = {
  title: string;
  subtitle: string;
  statusItems: PlatformFoundationStatusItem[];
};
