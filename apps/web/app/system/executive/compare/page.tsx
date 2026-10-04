import { redirect } from 'next/navigation';

/** The comparison page is taken out for now (owner 2026-10-05). Its old address opens the overview instead of a missing page. */
export default function Page() { redirect('/system/executive'); }
