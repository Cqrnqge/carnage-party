import React from 'react';
import { useApp } from '../../store';
import ConfirmModal from './ConfirmModal';
import ImageModal from './ImageModal';
import ProfileModal from './ProfileModal';
import SettingsModal from './SettingsModal';
import CreateServerModal from './CreateServerModal';
import JoinServerModal from './JoinServerModal';
import InviteModal from './InviteModal';
import ServerSettingsModal from './ServerSettingsModal';
import ChannelSettingsModal from './ChannelSettingsModal';
import NewDmModal from './NewDmModal';
import DmSettingsModal from './DmSettingsModal';
import PinsModal from './PinsModal';
import BanMemberModal from './BanMemberModal';
import MemberRolesModal from './MemberRolesModal';
import SearchModal from './SearchModal';
import ForwardModal from './ForwardModal';
import StartStreamModal from './StartStreamModal';
import WatchPartySetupModal from '../watch/WatchPartySetupModal';
import WatchPartyView from '../watch/WatchPartyView';

export default function ModalRoot() {
  const modal = useApp((state) => state.modal);
  if (!modal) return null;
  const props = modal.props || {};

  switch (modal.type) {
    case 'confirm':
      return <ConfirmModal {...props} />;
    case 'image':
      return <ImageModal {...props} />;
    case 'profile':
      return <ProfileModal {...props} />;
    case 'settings':
      return <SettingsModal {...props} />;
    case 'createServer':
      return <CreateServerModal {...props} />;
    case 'joinServer':
      return <JoinServerModal {...props} />;
    case 'invite':
      return <InviteModal {...props} />;
    case 'serverSettings':
      return <ServerSettingsModal {...props} />;
    case 'channelSettings':
      return <ChannelSettingsModal {...props} />;
    case 'newDm':
      return <NewDmModal {...props} />;
    case 'dmSettings':
      return <DmSettingsModal {...props} />;
    case 'pins':
      return <PinsModal {...props} />;
    case 'banMember':
      return <BanMemberModal {...props} />;
    case 'memberRoles':
      return <MemberRolesModal {...props} />;
    case 'search':
      return <SearchModal {...props} />;
    case 'forward':
      return <ForwardModal {...props} />;
    case 'startStream':
      return <StartStreamModal {...props} />;
    case 'watchSetup':
      return <WatchPartySetupModal {...props} />;
    case 'watchParty':
      return <WatchPartyView {...props} />;
    default:
      return null;
  }
}
