import { useEffect, useRef } from 'react';
import { SkinViewer as SkinViewer3D, IdleAnimation, WalkingAnimation } from 'skinview3d';
import { cn } from '../lib/utils';

interface SkinViewerProps {
  uuid?: string;
  width?: number;
  height?: number;
  className?: string;
  animation?: 'idle' | 'walk' | 'cool' | 'hero' | 'wave' | 'sleep' | 'levitate' | 'sit' | 'none';
  zoom?: number;
  skinUrl?: string;
  rotationY?: number;
  headOnly?: boolean;
}

export function SkinViewer({
  uuid,
  width = 300,
  height = 400,
  className,
  animation = 'idle',
  zoom = 0.9,
  skinUrl,
  rotationY = 0,
  headOnly = false
}: SkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer3D | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Determine skin source: explicit URL -> UUID -> fallback
    let skinSource = `https://mc-heads.net/skin/maudado`;
    if (skinUrl) {
      skinSource = skinUrl;
    } else if (uuid) {
      skinSource = `https://mc-heads.net/skin/${uuid}`;
    }

    const viewer = new SkinViewer3D({
      canvas: canvasRef.current,
      width: width,
      height: height,
      skin: skinSource,
    });

    // Set initial view
    viewer.fov = 70;
    // User tuned values: Zoom 1.3, Offset -12, Body Visible
    viewer.zoom = headOnly ? zoom * 1.3 : zoom;

    // Disable animation
    // Clear existing animation
    viewer.animation = null;

    // Apply Rotation
    viewer.playerObject.rotation.y = rotationY;

    // Reset rotations to default (T-pose/straight)
    viewer.playerObject.skin.head.rotation.y = 0;
    viewer.playerObject.skin.head.rotation.x = 0;
    viewer.playerObject.skin.leftArm.rotation.x = 0;
    viewer.playerObject.skin.leftArm.rotation.z = 0;
    viewer.playerObject.skin.rightArm.rotation.x = 0;
    viewer.playerObject.skin.rightArm.rotation.z = 0;
    viewer.playerObject.skin.leftLeg.rotation.z = 0;
    viewer.playerObject.skin.rightLeg.rotation.z = 0;
    viewer.playerObject.skin.leftLeg.rotation.x = 0;
    viewer.playerObject.skin.rightLeg.rotation.x = 0;

    if (headOnly) {
      // Keep body visible (User preference)
      viewer.playerObject.skin.body.visible = true;
      viewer.playerObject.skin.leftArm.visible = true;
      viewer.playerObject.skin.rightArm.visible = true;
      viewer.playerObject.skin.leftLeg.visible = true;
      viewer.playerObject.skin.rightLeg.visible = true;

      // Center on head using config
      viewer.playerObject.position.y = -12;

      // Reset camera offset to look straight
      viewer.camera.position.y = 0;
      viewer.camera.position.x = 0;
    }

    // Apply specific pose/animation (only if not headOnly, or maybe head rotation?)
    if (!headOnly) {
      // --- ANIMATION / POSE LOGIC ---
      // We handle different animation types here. custom objects are used for non-standard animations.

      if (animation === 'idle') {
        // Standard Idle Animation (breathing, slight arm swing)
        viewer.animation = new IdleAnimation();

      } else if (animation === 'walk') {
        // Standard Walking Animation
        viewer.animation = new WalkingAnimation();

      } else if (animation === 'cool') {
        // [Static Pose] "Cool"
        // A relaxed stance with arms crossed/relaxed and one leg forward.
        // Restored based on user feedback.

        viewer.playerObject.skin.head.rotation.y = 0.3; // Turn head right (~17 deg)
        viewer.playerObject.skin.head.rotation.x = 0.1; // Tilt head down slightly

        viewer.playerObject.skin.leftArm.rotation.x = -0.1; // Move left arm forward slightly
        viewer.playerObject.skin.leftArm.rotation.z = 0.1;  // Move left arm out slightly

        viewer.playerObject.skin.rightArm.rotation.x = 0.2; // Move right arm back difference
        viewer.playerObject.skin.rightArm.rotation.z = -0.1; // Move right arm out

        viewer.playerObject.skin.leftLeg.rotation.z = 0.05; // Spread legs slightly
        viewer.playerObject.skin.rightLeg.rotation.z = -0.05;

      } else if (animation === 'hero') {
        // [Static Pose] "Hero"
        // Confident stance with hands on hips and chest out.

        viewer.playerObject.skin.head.rotation.y = -0.2; // Look slightly left
        viewer.playerObject.skin.head.rotation.x = -0.1; // Chin up (confidently)

        viewer.playerObject.skin.leftArm.rotation.z = -0.1; // Arm slightly out

        // Right arm on hip
        viewer.playerObject.skin.rightArm.rotation.x = 0;
        viewer.playerObject.skin.rightArm.rotation.z = -0.1;

        // Widen stance
        viewer.playerObject.skin.leftLeg.rotation.z = 0.1;  // Spread leg left
        viewer.playerObject.skin.rightLeg.rotation.z = -0.1; // Spread leg right

      } else if (animation === 'wave') {
        // [Animated] "Wave"
        // Uses a custom animation loop to wave the right arm.
        // Logic updated to prevent clipping through the head.
        viewer.animation = null;

        const waveSpeed = 5; // Multiplier for wave speed (higher = faster)
        const waveAnimObject = {
          update: () => {
            const t = Date.now() / 1000;
            if (viewer.playerObject) {
              // Arm waving logic:
              // 2.6 = Base angle (almost straight up, ~150 degrees)
              // Math.sin(t * waveSpeed) = Oscillates between -1 and 1
              // * 0.3 = Amplitude of wave (approx +/- 17 degrees)
              viewer.playerObject.skin.rightArm.rotation.z = 3.9 + Math.sin(t * waveSpeed) * 0.175;

              // -0.1 = Slight forward tilt to avoid clipping ear/head
              viewer.playerObject.skin.rightArm.rotation.x = -0.2;
              viewer.playerObject.skin.rightArm.rotation.y = 0;

              viewer.playerObject.skin.leftArm.rotation.z = 0.2; // Arm slightly out
              viewer.playerObject.skin.leftArm.rotation.x = -0.05; // Slight forward tilt

              // Legs
              viewer.playerObject.skin.leftLeg.rotation.z = 0.05; // Spread leg left
              viewer.playerObject.skin.rightLeg.rotation.z = -0.05; // Spread leg right
            }
          }
        } as any;
        viewer.animation = waveAnimObject;

      } else if (animation === 'sleep') {
        // [Animated] "Sleep"
        // Character is nodding off with slow, rhythmic breathing.
        const sleepAnimObject = {
          update: () => {
            const t = Date.now() / 1000;
            if (viewer.playerObject) {
              // Slower breathing (t * 1.5 slows it down)
              // 0.5 = Base head down angle
              // 0.08 = Nod amplitude
              viewer.playerObject.skin.head.rotation.x = 0.5 + Math.sin(t * 1.5) * 0.09;

              // Body breathing motion
              // + 1 = Phase offset (body moves slightly after head)
              // 0.08 = Subtle body heave
              viewer.playerObject.skin.body.rotation.x = 0.2 + Math.sin(t * 1.5 + 1) * 0.025;

              viewer.playerObject.skin.leftArm.rotation.x = -0.1;
              viewer.playerObject.skin.leftArm.rotation.z = 0.1;

              viewer.playerObject.skin.rightArm.rotation.x = -0.1;
              viewer.playerObject.skin.rightArm.rotation.z = -0.1;
            }
          }
        } as any;
        viewer.animation = sleepAnimObject;

      } else if (animation === 'levitate') {
        // [Animated] "Levitate"
        // Character floats up and down while slowly spinning.
        // Legs are kept straight as requested.
        const levitateAnim = {
          update: (_time: number, _delta: number) => {
            const t = Date.now() / 1000;
            if (viewer.playerObject) {
              // Float (slower)
              // Math.sin(t * 1) = Slow oscillation (1 cycle per 2pi seconds)
              // * 1.4 = Amplitude (float height range)
              viewer.playerObject.position.y = Math.sin(t * 1) * 1.4;

              // Spin (slower)
              // += 0.01 = Rotates ~0.6 degrees per frame
              viewer.playerObject.rotation.y += 0.01;

              // Straight Legs (default 0)
              viewer.playerObject.skin.leftLeg.rotation.x = 0.075;
              viewer.playerObject.skin.rightLeg.rotation.x = -0.075;

              // Arms out slightly like balancing
              viewer.playerObject.skin.leftArm.rotation.z = 0.1;
              viewer.playerObject.skin.rightArm.rotation.z = -0.1;
            }
          }
        } as any;
        viewer.animation = levitateAnim;

      } else if (animation === 'sit') {
        // [Static Pose] "Sit"
        // Character is sitting down with legs forward.
        // Position adjusted to look correct on the background.
        viewer.playerObject.position.y = -5; // Lowered Y to -5 to sit "on" the ground/UI element

        viewer.playerObject.skin.leftLeg.rotation.x = -1.5; // Legs forward (~90 degrees)
        viewer.playerObject.skin.rightLeg.rotation.x = -1.5;

        viewer.playerObject.skin.leftArm.rotation.x = -0.5; // Arms resting on legs/lap
        viewer.playerObject.skin.rightArm.rotation.x = -0.5;
      }
    }
    // Remove controls (Static view)

    // Remove controls (Static view)
    viewer.controls.enableZoom = false;
    viewer.controls.enableRotate = false;
    viewer.controls.enablePan = false;

    viewerRef.current = viewer;

    // Handle Resize
    const handleResize = () => {
      if (canvasRef.current) {
        viewer.width = width;
        viewer.height = height;
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      viewer.dispose();
    };
  }, [uuid, width, height, animation, zoom, skinUrl, rotationY]);

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <canvas ref={canvasRef} className="cursor-grab active:cursor-grabbing" />
    </div>
  );
}
