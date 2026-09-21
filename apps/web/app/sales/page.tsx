import { redirect } from 'next/navigation';
import { SALES_HOME_PATH } from '@/common/auth/session-gate.logic';

// `/sales` is the area, not a page: the console's first screen is the deal list.
export default function SalesRoute() {
  redirect(SALES_HOME_PATH);
}
