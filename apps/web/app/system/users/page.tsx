import { redirect } from 'next/navigation';

// User lookup merged into the partners page; keep old bookmarks/links working.
export default function SystemUsersRoute() {
  redirect('/system/partners');
}
