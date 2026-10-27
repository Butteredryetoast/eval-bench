import Workspace from '../../components/workspace';
import { notFound,redirect } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const segments = (await params).path || [];
  if(segments.length===1&&segments[0]==='topics')redirect('/hotspots');
  if(segments.length===1&&segments[0]==='runs')redirect('/instances?view=batches');
  if(segments.length===2&&segments[0]==='hotspots'&&segments[1]==='handoff')redirect('/hotspots/cases');
  const valid = (segments[0] === 'hotspots' && (segments.length === 1 || segments.length === 2 && ['cases','research','handoff','catalogue','rules','usage','help','connections'].includes(segments[1]) || segments.length === 3 && segments[1] === 'events')) || !segments.length || (segments.length === 1 && ['launch', 'runs', 'materials', 'topics', 'write', 'instances'].includes(segments[0])) || (segments.length === 2 && ['c', 'r', 'a', 'write'].includes(segments[0]));
  if (!valid) notFound();
  return <Workspace />;
}
