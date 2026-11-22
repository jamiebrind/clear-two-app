import { useEffect, useId, useRef, useState } from 'react';
import { Link2, RefreshCw, Unlink2, Volume2, VolumeX } from 'lucide-react';
import { requestJson } from './client.ts';
import type { GroupAction, GroupState, RoomSummary } from './rooms.ts';

type GroupMember = GroupState['members'][number];

interface GroupControlsProps {
  room: RoomSummary;
  rooms: RoomSummary[];
  online: boolean;
  onChange: () => void;
}

export function GroupControls({ room, rooms, online, onChange }: GroupControlsProps) {
  const [group, setGroup] = useState<GroupState>();
  const [memberId, setMemberId] = useState('');
  const [groupVolumeDraft, setGroupVolumeDraft] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readError, setReadError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const reading = useRef<Promise<GroupState> | null>(null);
  const changing = useRef(false);
  const endpoint = `/api/rooms/${encodeURIComponent(room.id)}/group`;

  async function refresh(showLoading = false) {
    if (reading.current || changing.current) return;
    reading.current = requestJson<GroupState>(endpoint);
    if (showLoading) setLoading(true);
    try {
      setGroup(await reading.current);
      setReadError('');
    } catch (problem) {
      setReadError(problem instanceof Error ? problem.message : 'Could not check group status.');
    } finally {
      reading.current = null;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!online) return;
    void refresh(true);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [online]);

  async function apply(action: GroupAction) {
    if (!online || !group || group.isGuest || readError || changing.current) return;
    changing.current = true;
    setPending(true);
    setError('');
    setNotice('');
    let failed = false;
    try {
      await reading.current?.catch(() => {});
      setGroup(await requestJson<GroupState>(endpoint, action, 16000));
      setReadError('');
      if (action.action === 'join') setMemberId('');
      if (action.action === 'group-volume') setNotice(`All speakers set to ${action.volume}%.`);
    } catch (problem) {
      failed = true;
      setError(problem instanceof Error ? problem.message : 'Could not confirm the group change.');
    } finally {
      changing.current = false;
      setPending(false);
      if (failed) void refresh(true);
      onChange();
    }
  }

  const candidates = rooms.filter(({ id }) => id !== room.id && !group?.members.some((member) => member.id === id));
  const selectedCandidate = candidates.some(({ id }) => id === memberId) ? memberId : '';
  const disabled = !online || pending || loading || Boolean(readError);
  const headingId = useId();
  const pickerId = useId();
  const groupVolumeId = useId();
  const hostVolume = group?.hostVolume ?? null;
  const groupVolume = groupVolumeDraft ?? hostVolume;
  const mixedLevels = groupVolumeDraft === null && group?.members.some((member) => member.volume !== hostVolume);
  const groupVolumeLabel = groupVolume === null ? 'Unavailable' : `${mixedLevels ? 'Host ' : ''}${groupVolume}%`;

  return <section className="sound group" aria-labelledby={headingId}>
    <div className="sound-heading">
      <h2 id={headingId}><Link2 size={19} aria-hidden="true" /> Group playback</h2>
      <button className="icon-button" type="button" onClick={() => void refresh(true)} disabled={!online || pending || loading} aria-label="Refresh group status" title="Refresh group status"><RefreshCw size={16} aria-hidden="true" /></button>
    </div>
    {group?.isGuest ? <p className="group-note">This room is playing in another room’s group. Open that room to manage the group.</p> : group ? <>
      <p className="group-note">{group.members.length > 0
        ? 'These rooms play audio from this speaker.'
        : rooms.length === 1 ? 'Scan the network or add a speaker to group rooms.' : 'Add another room to play the same audio there.'}</p>
      {group.members.length > 0 && <>
        <div className="group-volume">
          <label htmlFor={groupVolumeId}>All speakers volume<span>{groupVolumeLabel}</span></label>
          <div className="group-picker">
            <input id={groupVolumeId} type="range" min="0" max="100" value={groupVolume ?? 0} disabled={disabled || hostVolume === null}
              onChange={(event) => setGroupVolumeDraft(Number(event.target.value))} />
            <button className="primary" type="button" disabled={disabled || hostVolume === null || groupVolume === null}
              onClick={async () => {
                if (groupVolume === null) return;
                await apply({ action: 'group-volume', volume: groupVolume });
                setGroupVolumeDraft(null);
              }}>Set all volumes</button>
          </div>
        </div>
        <ul className="group-list">
          {group.members.map((member) => <MemberControls key={member.id} member={member} disabled={disabled} apply={apply} />)}
        </ul>
      </>}
      {candidates.length > 0 && <form className="group-add" onSubmit={(event) => {
        event.preventDefault();
        if (selectedCandidate) void apply({ action: 'join', memberId: selectedCandidate });
      }}>
        <label htmlFor={pickerId}>Add room to group</label>
        <div className="group-picker">
          <select id={pickerId} value={selectedCandidate} onChange={(event) => setMemberId(event.target.value)} disabled={disabled}>
            <option value="">Choose a room</option>
            {candidates.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
          <button className="primary" type="submit" disabled={disabled || !selectedCandidate}>Add room</button>
        </div>
      </form>}
      {group.members.length > 0 && <button className="mute group-ungroup" type="button" disabled={disabled} onClick={() => void apply({ action: 'ungroup' })}>
        <Unlink2 size={16} aria-hidden="true" />Ungroup all rooms
      </button>}
    </> : !readError && <p className="group-note" role="status">{online ? 'Checking group status…' : 'Group status is unavailable while this room is offline.'}</p>}
    {pending && <p className="group-note" role="status">Updating group…</p>}
    {notice && <p className="group-note" role="status">{notice}</p>}
    {error && <p className="feedback" role="alert">{error}</p>}
    {readError && <p className="feedback" role="status">{readError} Refresh group status to try again.</p>}
  </section>;
}

function MemberControls({ member, disabled, apply }: {
  member: GroupMember;
  disabled: boolean;
  apply: (action: GroupAction) => Promise<void>;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const volumeId = useId();
  const volume = draft ?? member.volume;
  const muteLabel = member.muted ? 'Unmute' : 'Mute';

  async function applyVolume() {
    if (draft === null) return;
    await apply({ action: 'volume', memberId: member.id, volume: draft });
    setDraft(null);
  }

  return <li className="group-member">
    <div className="member-header">
      <h3>{member.name}</h3>
      <div className="member-actions">
        <button className="icon-button" type="button" disabled={disabled || member.muted === null} aria-label={`${muteLabel} ${member.name}`} title={`${muteLabel} ${member.name}`}
          onClick={() => void apply({ action: 'mute', memberId: member.id, mute: !member.muted })}>
          {member.muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
        </button>
        <button className="mute" type="button" disabled={disabled} aria-label={`Remove ${member.name} from group`}
          onClick={() => void apply({ action: 'remove', memberId: member.id })}>Remove</button>
      </div>
    </div>
    <label htmlFor={volumeId}><span className="visually-hidden">{member.name} </span>Volume<span>{volume === null ? 'Unavailable' : `${volume}%`}</span></label>
    <div className="group-picker">
      <input id={volumeId} type="range" min="0" max="100" value={volume ?? 0} disabled={disabled || member.volume === null}
        onChange={(event) => setDraft(Number(event.target.value))} />
      <button className="primary" type="button" aria-label={`Set ${member.name} volume`} disabled={disabled || member.volume === null || draft === null || draft === member.volume}
        onClick={() => void applyVolume()}>Set volume</button>
    </div>
  </li>;
}
