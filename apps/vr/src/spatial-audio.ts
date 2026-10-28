import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import type * as THREE from "three";

export interface SpatialAudioOptions {
  /** Metres within which you hear someone. Tracks beyond this are unsubscribed to save bandwidth. */
  hearingRange?: number;
  /** Where each HubID actor's avatar is, by HubID id. */
  positionOf: (hubId: number) => THREE.Vector3 | undefined;
  /** The listener (usually the camera). */
  listener: THREE.Object3D;
}

interface Voice {
  participant: RemoteParticipant;
  publication: RemoteTrackPublication;
  panner?: PannerNode;
  source?: MediaStreamAudioSourceNode;
  el?: HTMLAudioElement;
}

/** `hub:<id>` identities come from apps/presence/src/media.ts. */
const hubIdOf = (p: RemoteParticipant) => Number(p.attributes.hubId ?? p.identity.replace(/^hub:/, ""));

/**
 * Proximity voice for a presence room: each remote voice comes from its
 * avatar's position (HRTF panning, distance falloff), and only voices within
 * hearing range are subscribed.
 */
export class SpatialAudio {
  readonly room = new Room({ adaptiveStream: true, dynacast: true });
  private readonly ctx = new AudioContext();
  private readonly voices = new Map<string, Voice>();
  private readonly range: number;

  constructor(private readonly opts: SpatialAudioOptions) {
    this.range = opts.hearingRange ?? 40;
    this.room
      .on(RoomEvent.TrackPublished, (pub, participant) => this.track(pub, participant))
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => this.attach(track, pub, participant))
      .on(RoomEvent.TrackUnsubscribed, (_t, pub) => this.detach(pub.trackSid))
      .on(RoomEvent.TrackUnpublished, (pub) => {
        this.detach(pub.trackSid);
        this.voices.delete(pub.trackSid);
      });
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token, { autoSubscribe: false });
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) this.track(pub, p);
    }
  }

  /** Call from a user gesture: browsers block audio and mic until then. */
  async enableMic(): Promise<void> {
    await this.ctx.resume();
    await this.room.startAudio();
    await this.room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
  }

  /** Call every frame. Updates the listener, voice positions, and which voices are subscribed. */
  update(): void {
    const l = this.opts.listener;
    const pos = l.getWorldPosition(new (l.position.constructor as typeof THREE.Vector3)());
    const fwd = l.getWorldDirection(new (l.position.constructor as typeof THREE.Vector3)());
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    L.positionX.setValueAtTime(pos.x, t);
    L.positionY.setValueAtTime(pos.y, t);
    L.positionZ.setValueAtTime(pos.z, t);
    L.forwardX.setValueAtTime(fwd.x, t);
    L.forwardY.setValueAtTime(fwd.y, t);
    L.forwardZ.setValueAtTime(fwd.z, t);

    for (const v of this.voices.values()) {
      const at = this.opts.positionOf(hubIdOf(v.participant));
      const dist = at ? at.distanceTo(pos) : Infinity;
      // Hysteresis avoids flapping at the boundary.
      if (!v.publication.isSubscribed && dist < this.range) v.publication.setSubscribed(true);
      else if (v.publication.isSubscribed && dist > this.range * 1.25) v.publication.setSubscribed(false);
      if (v.panner && at) {
        v.panner.positionX.setValueAtTime(at.x, t);
        v.panner.positionY.setValueAtTime(at.y + 1.6, t);
        v.panner.positionZ.setValueAtTime(at.z, t);
      }
    }
  }

  async disconnect(): Promise<void> {
    for (const sid of this.voices.keys()) this.detach(sid);
    await this.room.disconnect();
    await this.ctx.close();
  }

  private track(pub: RemoteTrackPublication, participant: RemoteParticipant) {
    if (pub.kind !== Track.Kind.Audio) return;
    this.voices.set(pub.trackSid, { participant, publication: pub });
  }

  private attach(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) {
    if (track.kind !== Track.Kind.Audio) return;
    const v = this.voices.get(pub.trackSid) ?? { participant, publication: pub };
    this.voices.set(pub.trackSid, v);
    const stream = new MediaStream([track.mediaStreamTrack]);
    // Chrome only feeds remote WebRTC audio into Web Audio if it is also attached to a (muted) element.
    v.el = new Audio();
    v.el.muted = true;
    v.el.srcObject = stream;
    void v.el.play().catch(() => {});
    v.source = this.ctx.createMediaStreamSource(stream);
    v.panner = new PannerNode(this.ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 2,
      maxDistance: this.range,
      rolloffFactor: 1.2,
    });
    v.source.connect(v.panner).connect(this.ctx.destination);
  }

  private detach(sid: string) {
    const v = this.voices.get(sid);
    if (!v) return;
    v.source?.disconnect();
    v.panner?.disconnect();
    if (v.el) v.el.srcObject = null;
    v.source = v.panner = v.el = undefined;
  }
}
