// The sandbox has no application session/localStorage. Only locale integration is fixed to Thai.
export const useLocale = () => ['th', () => {}] as const;
export const useWorkspaceLocale = () => 'th' as const;
export const t = (key: string) => key;
