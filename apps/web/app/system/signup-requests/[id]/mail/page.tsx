import SignupClaimHistoryPage from '@/features/system-signup-requests/SignupClaimHistoryPage';
export default async function Page({params}:{params:Promise<{id:string}>}) { return <SignupClaimHistoryPage requestId={(await params).id}/>; }
