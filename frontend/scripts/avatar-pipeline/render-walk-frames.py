"""
Render 2D sprite frames from Alex's rigged/animated GLB using headless Blender.

Usage:
    blender --background --python render-walk-frames.py -- <mode> <input.glb> <output_dir>

mode:
    probe  - renders 4 single frames (frame 0 of the animation) at raw azimuths
             0/90/180/270 degrees to <output_dir>/probe/az{deg}.png so a human
             (or the calling agent, via the Read tool) can visually determine
             which azimuth is actually "front" (character's face visible) and
             confirm left/right handedness against the legacy sprite set
             before committing to the full render.
    full   - renders the full 8-frame walk cycle for all 4 named directions
             (front/right/back/left) per DIRECTION_AZIMUTHS below, to
             <output_dir>/raw/{direction}-{1..8}.png.

DIRECTION_AZIMUTHS is the one thing to edit between the probe and full runs
once the correct facing has been visually confirmed.
"""

import math
import os
import sys

import bpy
import mathutils

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Elevated "OffshorlyChibi" house-style camera angle, looking down at the
# character.
#
# CORRECTED from 55.0: at 55 degrees the character's already-oversized chibi
# head (that proportion comes from the mesh geometry itself, confirmed by
# rendering at 0 degrees elevation - the head is just as huge there) rotates
# far enough over the torso, from the camera's point of view, that its round
# underside visually occludes almost the entire body below the chin - torso,
# arms, and legs disappear behind the head's silhouette in the projected 2D
# frame. This is a real occlusion effect of viewing angle x geometry, not a
# camera-scale/zoom problem, and no amount of ortho_scale/zoom-out fixes it
# (confirmed empirically: renders at several elevations, all correctly
# scaled to the same 88% fill target, show torso/arms/legs cleanly at 0-15
# degrees and progressively swallowed by the head from ~25 degrees up).
# 15 degrees keeps a visible "looking down slightly" elevated tilt while
# keeping the full head-to-feet silhouette (torso, both arms, both legs,
# both shoes) visible, matching the legacy 2D sprite's proportions.
CAMERA_ELEVATION_DEG = 15.0

# Azimuth (degrees, rotation around world Z) for each named direction. Fill
# these in AFTER running probe mode and visually confirming which raw azimuth
# shows the character's face (front) vs back, and which profile side is
# actually screen-left vs screen-right (compare against
# alex-walk-norm/left-1.png / right-1.png).
# NOTE: empirically confirmed via probe-mode renders + visual comparison
# against legacy alex-walk-norm/left-*.png and right-*.png (nose/glasses
# direction + step direction). The naive "right=90,left=270" azimuth
# assignment is backwards for this GLB's actual orientation - az90 renders
# the character facing/stepping toward screen-left (matches legacy "left"),
# az270 matches legacy "right". Mapped accordingly below.
DIRECTION_AZIMUTHS = {
    "front": 0,
    "right": 270,
    "back": 180,
    "left": 90,
}

PROBE_AZIMUTHS = [0, 90, 180, 270]

RENDER_WIDTH = 764  # 4x target 191x240
RENDER_HEIGHT = 960

FRAMES_PER_DIRECTION = 8

# Target fill ratio for the character's silhouette within the rendered
# frame height, matching the convention already established in
# frame-normalize.mjs (FRAME_FILL_RATIO = 0.88): the character should occupy
# ~88% of the frame's binding dimension, leaving ~12% total as
# headroom/footroom margin. Applied to the PROJECTED bounding-box extent
# (see compute_required_ortho_scale below), not the raw 3D height - at an
# oblique elevated camera angle those are not the same thing.
FRAME_FILL_RATIO = 0.88


# ---------------------------------------------------------------------------
# Scene setup helpers
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)


def get_mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def compute_world_bbox(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    min_co = mathutils.Vector((math.inf, math.inf, math.inf))
    max_co = mathutils.Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            mesh = eval_obj.to_mesh()
        except RuntimeError:
            continue
        if mesh is None:
            continue
        mat = eval_obj.matrix_world
        for v in mesh.vertices:
            world_co = mat @ v.co
            min_co.x = min(min_co.x, world_co.x)
            min_co.y = min(min_co.y, world_co.y)
            min_co.z = min(min_co.z, world_co.z)
            max_co.x = max(max_co.x, world_co.x)
            max_co.y = max(max_co.y, world_co.y)
            max_co.z = max(max_co.z, world_co.z)
        eval_obj.to_mesh_clear()
    return min_co, max_co


def update_projected_extents(objects, extents):
    """Project every actual mesh vertex (not synthetic AABB corners) onto
    each azimuth's camera right/up axes, updating running (min, max) pairs
    in extents in place.

    extents: dict of azimuth_deg -> [right, up, min_r, max_r, min_u, max_u]
    where right/up are precomputed unit basis vectors for that azimuth.

    WHY NOT AABB CORNERS: projecting the 8 corners of an axis-aligned
    bounding box onto an oblique (non-axis-aligned) view axis systematically
    OVER-estimates the true projected extent, because a box corner like
    (min_x, min_y, min_z) combines per-axis extremes that may not co-exist
    together on any real point of the character's surface (the character
    is not a box, and its real surface may not reach that combined
    extreme). At a steep elevation this inflated estimate
    can be ~2x the real projected silhouette height, which is exactly why
    an ortho_scale sized off bbox corners left the character rendering far
    smaller in frame than the intended fill ratio. Projecting actual
    vertices gives the true silhouette envelope.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            mesh = eval_obj.to_mesh()
        except RuntimeError:
            continue
        if mesh is None:
            continue
        mat = eval_obj.matrix_world
        for v in mesh.vertices:
            world_co = mat @ v.co
            for az, entry in extents.items():
                right, up, min_r, max_r, min_u, max_u = entry
                r = world_co.dot(right)
                u = world_co.dot(up)
                entry[2] = min(min_r, r)
                entry[3] = max(max_r, r)
                entry[4] = min(min_u, u)
                entry[5] = max(max_u, u)
        eval_obj.to_mesh_clear()


def setup_camera(target, ortho_scale, distance):
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.sensor_fit = "VERTICAL"
    cam_obj = bpy.data.objects.new("SpriteCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    return cam_obj


def camera_direction(azimuth_deg, elevation_deg):
    az = math.radians(azimuth_deg)
    elev = math.radians(elevation_deg)
    return mathutils.Vector(
        (
            math.sin(az) * math.cos(elev),
            -math.cos(az) * math.cos(elev),
            math.sin(elev),
        )
    )


def camera_basis(azimuth_deg, elevation_deg):
    """Return (right, up) unit vectors for the camera's view plane at the
    given azimuth/elevation, matching the exact orientation aim_camera()
    will apply (same to_track_quat('-Z', 'Y') convention) - this is what we
    need to correctly project the bounding box onto the camera's actual
    view axes, not the raw world axes."""
    direction = camera_direction(azimuth_deg, elevation_deg)
    looking_direction = -direction
    rot_quat = looking_direction.to_track_quat("-Z", "Y")
    right = rot_quat @ mathutils.Vector((1.0, 0.0, 0.0))
    up = rot_quat @ mathutils.Vector((0.0, 1.0, 0.0))
    return right, up


def aim_camera(cam_obj, azimuth_deg, elevation_deg, target, distance):
    direction = camera_direction(azimuth_deg, elevation_deg)
    cam_obj.location = target + direction * distance
    looking_direction = target - cam_obj.location
    rot_quat = looking_direction.to_track_quat("-Z", "Y")
    cam_obj.rotation_euler = rot_quat.to_euler()


def compute_required_ortho_scale(
    min_co, max_co, azimuths, elevation_deg, fill_ratio, aspect_ratio
):
    """Compute the orthographic scale (vertical extent, since sensor_fit is
    VERTICAL) needed so the character's full bounding box fits within
    fill_ratio of the frame, across ALL given azimuths.

    BUG THIS FIXES: the old code sized the camera using only the raw
    world-space Z height of the bounding box (dims.z). That is only correct
    for a camera looking perfectly horizontally. This camera is elevated
    55deg above horizontal, so its actual view-plane "up" axis is a mix of
    world Z and the horizontal (depth) axis - meaning the character's
    front-to-back depth (body thickness, leg swing during the stride, etc.)
    also projects INTO the vertical extent of the rendered frame, on top of
    the raw Z height. Using dims.z alone therefore under-estimated the
    required frame size, producing a camera zoomed in far too tight (the
    symptom: head fills the whole frame, torso/limbs cropped out).

    Fix: project all 8 world-space bbox corners onto the camera's actual
    right/up view axes (given its real rotation at each azimuth) and take
    the true min/max extent along each axis. That is the real projected
    footprint the camera needs to fit.
    """
    corners = [
        mathutils.Vector((x, y, z))
        for x in (min_co.x, max_co.x)
        for y in (min_co.y, max_co.y)
        for z in (min_co.z, max_co.z)
    ]
    center = (min_co + max_co) * 0.5

    required_scale = 0.0
    for az in azimuths:
        right, up = camera_basis(az, elevation_deg)
        up_vals = [ (c - center).dot(up) for c in corners ]
        right_vals = [ (c - center).dot(right) for c in corners ]
        projected_height = max(up_vals) - min(up_vals)
        projected_width = max(right_vals) - min(right_vals)

        scale_from_height = projected_height / fill_ratio
        # sensor_fit is VERTICAL: rendered width = ortho_scale * aspect_ratio.
        # Make sure the projected width also fits within fill_ratio of that.
        scale_from_width = projected_width / (fill_ratio * aspect_ratio)

        required_scale = max(required_scale, scale_from_height, scale_from_width)

    return required_scale


def setup_lighting():
    light_data = bpy.data.lights.new(name="KeyLight", type="SUN")
    light_data.energy = 3.0
    light_obj = bpy.data.objects.new(name="KeyLight", object_data=light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    light_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    fill_data = bpy.data.lights.new(name="FillLight", type="SUN")
    fill_data.energy = 1.2
    fill_obj = bpy.data.objects.new(name="FillLight", object_data=fill_data)
    bpy.context.scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(55), 0, math.radians(-145))

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bpy.context.scene.world = world


def setup_render_settings():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = RENDER_WIDTH
    scene.render.resolution_y = RENDER_HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv
    try:
        idx = argv.index("--")
        args = argv[idx + 1 :]
    except ValueError:
        args = []

    if len(args) != 3:
        print("Usage: blender --background --python render-walk-frames.py -- <probe|full> <input.glb> <output_dir>")
        sys.exit(1)

    mode, input_glb, output_dir = args
    input_glb = os.path.abspath(input_glb)
    output_dir = os.path.abspath(output_dir)

    clear_scene()
    import_glb(input_glb)

    mesh_objects = get_mesh_objects()
    if not mesh_objects:
        print("ERROR: no mesh objects found after GLB import")
        sys.exit(1)

    # Determine animation frame range strictly from any action(s) found on
    # imported objects. Do NOT fall back to/merge with the scene's default
    # frame_start/frame_end (1-250) unless no action exists at all - merging
    # with that default silently extends the sampled range past the actual
    # baked animation and wastes frames rendering a frozen end pose.
    scene = bpy.context.scene
    action_ranges = []
    for obj in bpy.context.scene.objects:
        if obj.animation_data and obj.animation_data.action:
            action_ranges.append(obj.animation_data.action.frame_range)
    if action_ranges:
        frame_start = min(fr[0] for fr in action_ranges)
        frame_end = max(fr[1] for fr in action_ranges)
    else:
        frame_start = scene.frame_start
        frame_end = scene.frame_end
    print(f"Animation frame range: {frame_start} - {frame_end}")

    # Compute the bbox across several sampled poses through the WALK CYCLE
    # (not just the bind/rest pose at import time) so the camera framing
    # accounts for how far arms/legs swing/step during the actual animation.
    # Using only the static import-time pose clipped feet/legs in early
    # testing because the bind pose sits noticeably differently than
    # mid-stride poses.
    min_co = mathutils.Vector((math.inf, math.inf, math.inf))
    max_co = mathutils.Vector((-math.inf, -math.inf, -math.inf))
    bbox_sample_count = 8
    span = frame_end - frame_start
    for i in range(bbox_sample_count):
        t = i / max(bbox_sample_count - 1, 1)
        scene.frame_set(int(round(frame_start + t * span)))
        sample_min, sample_max = compute_world_bbox(mesh_objects)
        min_co.x, min_co.y, min_co.z = (
            min(min_co.x, sample_min.x),
            min(min_co.y, sample_min.y),
            min(min_co.z, sample_min.z),
        )
        max_co.x, max_co.y, max_co.z = (
            max(max_co.x, sample_max.x),
            max(max_co.y, sample_max.y),
            max(max_co.z, sample_max.z),
        )

    dims = max_co - min_co
    center = (min_co + max_co) * 0.5
    target = mathutils.Vector((center.x, center.y, center.z))

    aspect_ratio = RENDER_WIDTH / RENDER_HEIGHT
    azimuths_used = sorted(set(list(DIRECTION_AZIMUTHS.values()) + PROBE_AZIMUTHS))
    ortho_scale = compute_required_ortho_scale(
        min_co, max_co, azimuths_used, CAMERA_ELEVATION_DEG, FRAME_FILL_RATIO, aspect_ratio
    )
    distance = max(dims.x, dims.y, dims.z) * 5 + 1.0

    print(f"BBOX (walk-cycle union) min={tuple(min_co)} max={tuple(max_co)} dims={tuple(dims)} target={tuple(target)}")
    print(f"ortho_scale={ortho_scale} distance={distance}")

    setup_lighting()
    setup_render_settings()
    cam_obj = setup_camera(target, ortho_scale, distance)

    if mode == "probe":
        os.makedirs(os.path.join(output_dir, "probe"), exist_ok=True)
        scene.frame_set(int(frame_start))
        for az in PROBE_AZIMUTHS:
            aim_camera(cam_obj, az, CAMERA_ELEVATION_DEG, target, distance)
            out_path = os.path.join(output_dir, "probe", f"az{az}.png")
            render_to(out_path)
            print(f"Rendered probe {out_path}")
    elif mode == "full":
        os.makedirs(os.path.join(output_dir, "raw"), exist_ok=True)
        span = frame_end - frame_start
        for direction, az in DIRECTION_AZIMUTHS.items():
            aim_camera(cam_obj, az, CAMERA_ELEVATION_DEG, target, distance)
            for i in range(FRAMES_PER_DIRECTION):
                t = i / FRAMES_PER_DIRECTION
                frame_num = frame_start + t * span
                scene.frame_set(int(round(frame_num)))
                out_path = os.path.join(output_dir, "raw", f"{direction}-{i + 1}.png")
                render_to(out_path)
                print(f"Rendered {out_path} (frame {frame_num})")
    else:
        print(f"ERROR: unknown mode '{mode}'")
        sys.exit(1)

    print("DONE")


if __name__ == "__main__":
    main()
