import { MeasuredTemplatePF2e } from "./measured-template";
import { TokenPF2e } from "./token";

/**
 * Measure the minimum distance between two rectangles
 * @param r0      The origin rectangle
 * @param r1      The destination rectangle
 * @param [reach] If this is a reach measurement, the origin actor's reach
 */
function measureDistanceRect(
    r0: NormalizedRectangle,
    r1: NormalizedRectangle,
    { reach = null }: { reach?: number | null } = {}
): number {
    if (!canvas.dimensions) return NaN;

    if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) {
        return canvas.grid.measureDistance(r0, r1);
    }

    const gridWidth = canvas.grid.grid.w;

    // Return early if the rectangles overlap
    const rectanglesOverlap = [
        [r0, r1],
        [r1, r0],
    ].some(([rA, rB]) => rB.right > rA.left && rB.left < rA.right && rB.bottom > rA.top && rB.top < rA.bottom);
    if (rectanglesOverlap) return 0;

    // Snap the dimensions and position of the rectangle to grid square units
    const snapBounds = (
        rectangle: NormalizedRectangle,
        { toward }: { toward: NormalizedRectangle }
    ): NormalizedRectangle => {
        const roundLeft = rectangle.left < toward.left ? Math.ceil : Math.floor;
        const roundTop = rectangle.top < toward.top ? Math.ceil : Math.floor;

        const left = roundLeft(rectangle.left / gridWidth) * gridWidth;
        const top = roundTop(rectangle.top / gridWidth) * gridWidth;
        const width = Math.ceil(rectangle.width / gridWidth) * gridWidth;
        const height = Math.ceil(rectangle.height / gridWidth) * gridWidth;

        return new NormalizedRectangle(left, top, width, height);
    };

    // Find the minimum distance between the rectangles for each dimension
    const r0Snapped = snapBounds(r0, { toward: r1 });
    const r1Snapped = snapBounds(r1, { toward: r0 });
    const dx = Math.max(r0Snapped.left - r1Snapped.right, r1Snapped.left - r0Snapped.right, 0) + gridWidth;
    const dy = Math.max(r0Snapped.top - r1Snapped.bottom, r1Snapped.top - r0Snapped.bottom, 0) + gridWidth;

    return measureDistanceOnGrid({ dx, dy }, { reach });
}

/**
 * Measure distance using Pathfinder 2e grid-counting rules
 * @param p0 The origin point
 * @param p1 The destination point
 */
function measureDistance(p0: Point, p1: Point): number {
    if (!canvas.dimensions) return NaN;

    if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) {
        return canvas.grid.measureDistance(p0, p1);
    }

    return measureDistanceOnGrid(new Ray(p0, p1));
}

/**
 * Given the distance in each dimension, measure the distance in grid units
 * @param segment A pair of x/y distances constituting the line segment between two points
 * @param [reach] If this is a reach measurement, the origin actor's reach
 */
function measureDistanceOnGrid(
    segment: { dx: number; dy: number },
    { reach = null }: { reach?: number | null } = {}
): number {
    if (!canvas.dimensions) return NaN;

    const gridSize = canvas.dimensions.size;
    const gridDistance = canvas.dimensions.distance;

    const nx = Math.ceil(Math.abs(segment.dx / gridSize));
    const ny = Math.ceil(Math.abs(segment.dy / gridSize));

    // Get the number of straight and diagonal moves
    const squares = { diagonal: Math.min(nx, ny), straight: Math.abs(ny - nx) };

    // "Unlike with measuring most distances, 10-foot reach can reach 2 squares diagonally." (CRB pg 455)
    const reduction = squares.diagonal > 1 && reach === 10 ? 1 : 0;

    // Diagonals in PF pretty much count as 1.5 times a straight
    const distance = Math.floor(squares.diagonal * 1.5 + squares.straight) - reduction;

    return distance * gridDistance;
}

/** Highlight grid according to Pathfinder 2e effect-area shapes */
function highlightGrid({ type, object, colors, data }: HighlightGridParams): void {
    // Only highlight for objects that are non-previews (have IDs)
    if (!object.id) return;

    const { grid, dimensions } = canvas;
    if (!(grid && dimensions)) return;

    // Set data defaults
    data.angle ??= 0;
    data.direction ??= 45;

    // Clear existing highlight
    const highlightLayer = grid.getHighlightLayer(object.highlightId)?.clear();
    const { x, y } = data;

    const [cx, cy] = grid.getCenter(x, y);
    const [col0, row0] = grid.grid.getGridPositionFromPixels(cx, cy);
    const minAngle = (360 + ((data.direction - data.angle * 0.5) % 360)) % 360;
    const maxAngle = (360 + ((data.direction + data.angle * 0.5) % 360)) % 360;

    const withinAngle = (min: number, max: number, value: number) => {
        min = (360 + (min % 360)) % 360;
        max = (360 + (max % 360)) % 360;
        value = (360 + (value % 360)) % 360;

        if (min < max) return value >= min && value <= max;
        return value >= min || value <= max;
    };

    const originOffset = { x: 0, y: 0 };
    // Offset measurement for cones
    // Offset is to ensure that cones only start measuring from cell borders, as in https://www.d20pfsrd.com/magic/#Aiming_a_Spell
    if (type === "cone") {
        // Degrees anticlockwise from pointing right. In 45-degree increments from 0 to 360
        const dir = (data.direction >= 0 ? 360 - data.direction : -data.direction) % 360;
        // If we're not on a border for X, offset by 0.5 or -0.5 to the border of the cell in the direction we're looking on X axis
        const xOffset =
            x % dimensions.size !== 0 ? Math.sign((1 * Math.round(Math.cos(Math.toRadians(dir)) * 100)) / 100) / 2 : 0;
        // Same for Y, but cos Y goes down on screens, we invert
        const yOffset =
            data.y % dimensions.size !== 0
                ? -Math.sign((1 * Math.round(Math.sin(Math.toRadians(dir)) * 100)) / 100) / 2
                : 0;
        originOffset.x = xOffset;
        originOffset.y = yOffset;
    }

    // Point we are measuring distances from
    let origin = {
        x: x + originOffset.x * dimensions.size,
        y: y + originOffset.y * dimensions.size,
    };

    // Get number of rows and columns
    const rowCount = Math.ceil((data.distance * 1.5) / dimensions.distance / (dimensions.size / grid.h));
    const columnCount = Math.ceil((data.distance * 1.5) / dimensions.distance / (dimensions.size / grid.w));

    for (let a = -columnCount; a < columnCount; a++) {
        for (let b = -rowCount; b < rowCount; b++) {
            // Position of cell's top-left corner, in pixels
            const [gx, gy] = canvas.grid.grid.getPixelsFromGridPosition(col0 + a, row0 + b);
            // Position of cell's center, in pixels
            const [cellCenterX, cellCenterY] = [gx + dimensions.size * 0.5, gy + dimensions.size * 0.5];

            // Determine point of origin
            origin = { x, y };
            origin.x += originOffset.x * dimensions.size;
            origin.y += originOffset.y * dimensions.size;

            const ray = new Ray(origin, { x: cellCenterX, y: cellCenterY });

            const rayAngle = (360 + ((ray.angle / (Math.PI / 180)) % 360)) % 360;
            if (type === "cone" && ray.distance > 0 && !withinAngle(minAngle, maxAngle, rayAngle)) {
                continue;
            }

            // Determine point we're measuring the distance to - always in the center of a grid square
            const destination = { x: cellCenterX, y: cellCenterY };

            const distance = measureDistance(destination, origin);
            if (highlightLayer && distance <= data.distance) {
                grid.grid.highlightGridPosition(highlightLayer, {
                    x: gx,
                    y: gy,
                    border: colors.border,
                    color: colors.fill,
                });
            }
        }
    }
}

interface HighlightGridParams {
    type: "burst" | "cone" | "emanation";
    object: MeasuredTemplatePF2e | TokenPF2e;
    /** Border and fill colors in hexadecimal */
    colors: { border: number; fill: number };
    /** Shape data for the effect area: satisfied by MeasuredTemplateData */
    data: {
        x: number;
        y: number;
        distance: number;
        angle?: number;
        direction?: number;
    };
}

export { highlightGrid, measureDistanceRect };
