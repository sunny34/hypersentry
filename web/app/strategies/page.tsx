import { redirect } from 'next/navigation';

export default function StrategiesRedirect() {
    redirect('/terminal?tab=lab');
}
