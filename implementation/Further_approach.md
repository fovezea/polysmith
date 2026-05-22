
```markdown
# PolySmith Architecture & Implementation Guide

## A Practical Guide Based on FreeCAD's Lessons

This document consolidates the architectural decisions, performance considerations, and implementation priorities for PolySmith. It serves as both a reference and a roadmap.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [What FreeCAD Got Wrong (And How We Avoid It)](#what-freecad-got-wrong)
3. [The IPC Challenge: Why It Matters](#the-ipc-challenge)
4. [Priority 1: Local Constraint Solver](#priority-1-local-constraint-solver)
5. [Priority 2: Binary IPC Protocol](#priority-2-binary-ipc-protocol)
6. [Priority 3: Document Model in C++](#priority-3-document-model-in-c)
7. [Priority 4: Topological Naming Solution](#priority-4-topological-naming-solution)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Code Examples & Templates](#code-examples--templates)
10. [Testing Strategy](#testing-strategy)
11. [Performance Benchmarks](#performance-benchmarks)

---

## Architecture Overview

PolySmith is built as a desktop application with three main layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                           │
│  React + TypeScript + WebGL (Three.js)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Constraint Solver (planegcs compiled to WASM)         │   │
│  │  - Local constraint solving (zero IPC latency)         │   │
│  │  - Real-time sketch manipulation                        │   │
│  │  - Immediate visual feedback                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ Debounced JSON/Binary IPC
                                │ (infrequent, only on operation complete)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BRIDGE LAYER                                │
│  Tauri (Rust)                                                   │
│  - Secure IPC channel                                           │
│  - Binary serialization (MessagePack)                          │
│  - Persistent topology ID mapping                              │
│  - Calls into C++ CAD core                                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ Direct FFI calls
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CORE LAYER                                │
│  C++ + OpenCascade                                             │
│  - Document state ownership                                     │
│  - Feature history and parametric relationships                │
│  - 3D geometry operations (extrude, boolean, fillet)           │
│  - File persistence (FCStd, STEP, IGES)                        │
└─────────────────────────────────────────────────────────────────┘
```

**Repository Layout:**

```
PolySmith/
├── apps/
│   └── desktop-ui/           # React + Tauri application
│       ├── src/
│       │   ├── components/   # React UI components
│       │   ├── hooks/        # Custom React hooks
│       │   ├── wasm/         # planegcs WebAssembly module
│       │   └── ipc/          # IPC client utilities
│       └── package.json
│
├── native/
│   └── cad-core/             # C++ CAD core (CMake)
│       ├── src/
│       │   ├── document/     # Document model
│       │   ├── geometry/     # OpenCascade wrappers
│       │   ├── features/     # Parametric features
│       │   └── io/           # File import/export
│       └── CMakeLists.txt
│
├── protocol/
│   ├── schema/               # IPC message schemas
│   │   ├── messages.msgpack  # MessagePack schema
│   │   └── types.rs          # Rust type definitions
│   └── README.md
│
├── docs/
│   ├── architecture/         # System design documents
│   ├── decisions/            # Architecture Decision Records (ADRs)
│   └── roadmap/              # Implementation plans
│
└── third_party/
    └── occt/                 # Vendored OpenCascade source
```

---

## What FreeCAD Got Wrong (And How We Avoid It)

| FreeCAD Problem | PolySmith Solution |
|----------------|-------------------|
| Monolithic C++ with Qt (hard to modernize) | React + Tauri frontend, C++ core only for geometry |
| Constraint solver in same process as kernel (can't distribute) | WASM solver in UI, C++ kernel for heavy ops |
| Topological naming bug (geometry IDs change) | Persistent ID mapping in Rust bridge layer |
| System-installed OpenCascade (version conflicts) | Vendored OCCT, version-controlled |
| Coin3D rendering (jagged lines, dated look) | WebGL (Three.js) with proper anti-aliasing |
| UI entangled with core logic | Clear rule: React = intent only, C++ = state |
| Slow with complex sketches | Local solver + debounced IPC = smooth 60fps |
| Poor Windows theming | Modern web UI (CSS, shadcn/ui, Tailwind) |

---

## The IPC Challenge: Why It Matters

Your architecture places **all CAD state** on the C++ side and communicates over JSON IPC. This creates potential bottlenecks:

### Critical Performance Analysis

| Operation | IPC Frequency | Target Latency | Risk Level | Solution |
|-----------|---------------|----------------|------------|----------|
| Mouse drag in sketcher | 60+ times/second | <16ms | 🔴 **CRITICAL** | Move solver to WASM (local) |
| Constraint solving | Every mouse move | <16ms | 🔴 **CRITICAL** | Local WASM execution |
| 3D view redraw | 30-60 fps | <33ms | 🟡 **MODERATE** | Send mesh once, cache in UI |
| Feature recompute | On user action | <200ms | 🟢 **LOW** | Acceptable IPC latency |
| File save/load | Infrequent | <500ms | 🟢 **LOW** | Acceptable IPC latency |
| Parameter input (typed) | On blur/enter | <100ms | 🟢 **LOW** | Debounced IPC |

### The Non-Negotiable Conclusion

> **The constraint solver MUST run in the UI layer (WASM).** Attempting to run it on the C++ side will make the sketcher unusable due to IPC latency.

---

## Priority 1: Local Constraint Solver

### What You Need

The `planegcs` solver from FreeCAD, compiled to WebAssembly. It already has a WebAssembly port available.

### Implementation Steps

**Step 1: Add planegcs as a submodule**

```bash
cd apps/desktop-ui
git submodule add https://github.com/FreeCAD/FreeCAD/tree/master/src/Mod/Sketcher/App/planegcs wasm/planegcs-src
```

**Step 2: Build script for WASM (`wasm/build.sh`)**

```bash
#!/bin/bash
# Build planegcs to WebAssembly

# Using Emscripten
emcmake cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_CXX_FLAGS="-O3 -flto" \
  -B build-wasm

cmake --build build-wasm --target planegcs

# Copy output to React app
cp build-wasm/planegcs.js src/wasm/
cp build-wasm/planegcs.wasm src/wasm/
```

**Step 3: TypeScript wrapper (`src/wasm/planegcs.ts`)**

```typescript
// Type definitions for the planegcs WASM module
interface GCSGeometry {
  points: Array<{x: number, y: number, id: number}>;
  lines: Array<{start: number, end: number, id: number}>;
  circles: Array<{center: number, radius: number, id: number}>;
}

interface GCSConstraint {
  type: 'coincident' | 'horizontal' | 'vertical' | 'distance' | 'angle' | 'tangent';
  params: Record<string, unknown>;
  id: number;
}

interface GCSResult {
  solved: boolean;
  geometry: GCSGeometry;
  error?: string;
}

class PlanegcsSolver {
  private module: any = null;
  private initialized = false;

  async init() {
    // Load the WASM module
    const wasmModule = await import('./planegcs.js');
    this.module = await wasmModule.default();
    this.initialized = true;
  }

  solve(
    geometry: GCSGeometry, 
    constraints: GCSConstraint[]
  ): GCSResult {
    if (!this.initialized) {
      throw new Error('Solver not initialized');
    }

    // Convert geometry to solver's internal format
    const geoPtr = this.module.create_geometry(
      JSON.stringify(geometry)
    );
    
    // Convert constraints
    const constraintPtr = this.module.create_constraints(
      JSON.stringify(constraints)
    );
    
    // Run solver
    const resultPtr = this.module.solve(geoPtr, constraintPtr);
    const resultJson = this.module.get_result(resultPtr);
    
    // Clean up
    this.module.free_geometry(geoPtr);
    this.module.free_constraints(constraintPtr);
    this.module.free_result(resultPtr);
    
    return JSON.parse(resultJson);
  }

  // Incremental update (for drag operations)
  solveIncremental(
    geometry: GCSGeometry,
    constraints: GCSConstraint[],
    movingPointId: number,
    newPosition: {x: number, y: number}
  ): GCSResult {
    // Same pattern but with hint for solver
    // This runs in <1ms for typical sketches
  }
}

export const solver = new PlanegcsSolver();
```

**Step 4: React hook for sketch interaction (`src/hooks/useSketchSolver.ts`)**

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import { solver } from '../wasm/planegcs';

interface Point {
  x: number;
  y: number;
  id: string;
  constraints?: string[];
}

interface SketchState {
  points: Point[];
  lines: Array<{start: string, end: string}>;
  constraints: Constraint[];
  isSolved: boolean;
}

export function useSketchSolver(initialState: SketchState) {
  const [state, setState] = useState<SketchState>(initialState);
  const [isDirty, setIsDirty] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout>();

  // Local solve (called on every mouse move)
  const solveLocal = useCallback((
    movingPointId: string,
    newPosition: {x: number, y: number}
  ) => {
    // Convert to solver format
    const solverGeo = {
      points: state.points.map(p => ({
        x: p.x, y: p.y, id: parseInt(p.id)
      })),
      lines: state.lines.map(l => ({
        start: parseInt(l.start),
        end: parseInt(l.end),
        id: Math.random()
      })),
      circles: []
    };
    
    const solverConstraints = state.constraints.map(c => ({
      type: c.type,
      params: c.params,
      id: parseInt(c.id)
    }));
    
    // Run solver locally (in WASM)
    const result = solver.solveIncremental(
      solverGeo,
      solverConstraints,
      parseInt(movingPointId),
      newPosition
    );
    
    if (result.solved) {
      // Update local state with solved positions
      setState(prev => ({
        ...prev,
        points: prev.points.map(p => {
          const solvedPoint = result.geometry.points.find(
            sp => sp.id === parseInt(p.id)
          );
          if (solvedPoint) {
            return { ...p, x: solvedPoint.x, y: solvedPoint.y };
          }
          return p;
        }),
        isSolved: true
      }));
      
      // Mark as dirty so we sync to C++ core
      setIsDirty(true);
    }
    
    return result.solved;
  }, [state.points, state.lines, state.constraints]);

  // Sync to C++ core (debounced, after user stops dragging)
  const syncToCore = useCallback(() => {
    if (!isDirty) return;
    
    // Send final sketch state to Tauri backend
    window.__TAURI__.invoke('sketch_update', {
      sketchId: state.id,
      geometry: {
        points: state.points,
        lines: state.lines
      },
      constraints: state.constraints
    });
    
    setIsDirty(false);
  }, [state, isDirty]);

  // Debounced sync (stops spamming IPC)
  useEffect(() => {
    if (isDirty) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        syncToCore();
      }, 100); // Wait 100ms after last move
    }
    
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [isDirty, syncToCore]);

  return {
    state,
    solveLocal,
    syncToCore,
    isDirty
  };
}
```

**Step 5: React component for sketcher canvas (`src/components/SketcherCanvas.tsx`)**

```typescript
import { useRef, useEffect } from 'react';
import { useSketchSolver } from '../hooks/useSketchSolver';

export function SketcherCanvas({ initialSketch }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, solveLocal, syncToCore } = useSketchSolver(initialSketch);
  const dragState = useRef<{active: boolean, pointId: string | null}>({
    active: false,
    pointId: null
  });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.active || !dragState.current.pointId) return;
    
    // Get canvas-relative coordinates
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Solve locally (WASM) - this is FAST (<16ms)
    const solved = solveLocal(dragState.current.pointId, {x, y});
    
    if (solved) {
      // Redraw canvas with updated geometry
      drawSketch(state);
    }
  };

  const handleMouseUp = () => {
    dragState.current = { active: false, pointId: null };
    // Sync final state to C++ core (over IPC)
    syncToCore();
  };

  // drawSketch implementation using Canvas API or Three.js
  const drawSketch = (sketch: SketchState) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    
    // Draw lines
    sketch.lines.forEach(line => {
      const start = sketch.points.find(p => p.id === line.start);
      const end = sketch.points.find(p => p.id === line.end);
      if (start && end) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    });
    
    // Draw points
    sketch.points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      width={800}
      height={600}
      style={{ border: '1px solid #ccc' }}
    />
  );
}
```

### What This Achieves

- **Zero IPC latency** for drag operations (solver runs in WASM)
- **60fps interaction** even on modest hardware
- **C++ core stays authoritative** (final state syncs after drag)
- **Debounced IPC** prevents message flooding

---

## Priority 2: Binary IPC Protocol

### Replace JSON with MessagePack

JSON is human-readable but slow and large. MessagePack is binary, compact, and fast.

**Step 1: Add MessagePack dependencies**

```toml
# native/cad-core/Cargo.toml (Tauri backend)
[dependencies]
rmp-serde = "1.1"
serde = { version = "1.0", features = ["derive"] }
```

**Step 2: Define message schemas (`protocol/schema/messages.msgpack`)**

```rust
// Using Rust's serde for type safety
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
#[repr(u8)]
pub enum MessageType {
    SketchUpdate = 1,
    Extrude = 2,
    DocumentSave = 3,
    DocumentLoad = 4,
    MeshResponse = 5,
}

#[derive(Serialize, Deserialize)]
pub struct SketchUpdateMessage {
    pub sketch_id: String,
    pub geometry: Vec<Point>,
    pub constraints: Vec<Constraint>,
}

#[derive(Serialize, Deserialize)]
pub struct Point {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize)]
pub struct Constraint {
    pub id: u32,
    pub type_id: u8,
    pub params: Vec<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct MeshResponse {
    pub part_id: String,
    pub vertices: Vec<[f32; 3]>,  // 3D vertex positions
    pub indices: Vec<u32>,         // Triangle indices
}

// Helper for serialization
pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    rmp_serde::to_vec(msg).unwrap()
}

pub fn decode<T: DeserializeOwned>(data: &[u8]) -> T {
    rmp_serde::from_slice(data).unwrap()
}
```

**Step 3: Tauri command using MessagePack (`native/cad-core/src/lib.rs`)**

```rust
#[tauri::command]
async fn sketch_update(
    state: tauri::State<'_, AppState>,
    binary_data: Vec<u8>,  // MessagePack binary
) -> Result<String, String> {
    // Decode MessagePack
    let update: SketchUpdateMessage = rmp_serde::from_slice(&binary_data)
        .map_err(|e| format!("Failed to decode: {}", e))?;
    
    // Update document in C++ core
    let result = state.cad_core.update_sketch(
        &update.sketch_id,
        &update.geometry,
        &update.constraints
    );
    
    // Return success
    Ok("ok".to_string())
}

#[tauri::command]
async fn get_mesh(
    state: tauri::State<'_, AppState>,
    part_id: String,
) -> Result<Vec<u8>, String> {
    // Get mesh from C++ core
    let mesh = state.cad_core.tesselate_part(&part_id)?;
    
    // Encode as MessagePack
    let response = MeshResponse {
        part_id,
        vertices: mesh.vertices,
        indices: mesh.indices,
    };
    
    Ok(rmp_serde::to_vec(&response).unwrap())
}
```

**Step 4: TypeScript MessagePack client (`src/ipc/messagepack.ts`)**

```typescript
// Install: npm install @msgpack/msgpack
import { encode, decode } from '@msgpack/msgpack';

interface MeshResponse {
  part_id: string;
  vertices: number[][];  // [x,y,z][]
  indices: number[];
}

export class MessagePackIPC {
  private async invokeBinary(command: string, data: any): Promise<Uint8Array> {
    const encoded = encode(data);
    // Tauri doesn't support binary directly in invoke, so we send as base64
    // or use a custom HTTP endpoint
    const base64 = btoa(String.fromCharCode(...encoded));
    const response = await window.__TAURI__.invoke(command, { binaryData: base64 });
    return Uint8Array.from(atob(response as string), c => c.charCodeAt(0));
  }

  async updateSketch(sketchId: string, geometry: any, constraints: any[]) {
    const encoded = encode({
      sketch_id: sketchId,
      geometry,
      constraints
    });
    
    const base64 = btoa(String.fromCharCode(...encoded));
    await window.__TAURI__.invoke('sketch_update', { binaryData: base64 });
  }

  async getMesh(partId: string): Promise<MeshResponse> {
    const responseBinary = await this.invokeBinary('get_mesh', { partId });
    return decode(responseBinary) as MeshResponse;
  }
}
```

**Performance Comparison:**

| Format | Message Size | Encode Time | Decode Time |
|--------|--------------|-------------|-------------|
| JSON | 100% (baseline) | 1.0x | 1.0x |
| MessagePack | ~40% | 0.3x | 0.4x |
| CBOR | ~45% | 0.4x | 0.5x |

---

## Priority 3: Document Model in C++

### Keep State Ownership on Native Side

Your rule that "React owns presentation only" is correct for everything EXCEPT the active sketch being edited.

**C++ Document Architecture (`native/cad-core/src/document.rs`)**

```rust
// Using CXX for safe Rust↔C++ interop
use cxx::{CxxString, CxxVector};

#[cxx::bridge]
mod ffi {
    unsafe extern "C++" {
        include!("cad_core/document.h");
        
        type CADDocument;
        
        fn create_document() -> UniquePtr<CADDocument>;
        fn add_feature(&mut self, feature_type: &str, params: &CxxVector<f64>);
        fn recompute(&mut self);
        fn export_step(&self, path: &CxxString) -> bool;
        fn get_mesh(&self, part_id: &str) -> Vec<u8>;  // Returns MessagePack
        fn update_sketch(&mut self, sketch_id: &str, geometry_json: &str);
    }
}

// Rust wrapper
pub struct Document {
    inner: cxx::UniquePtr<ffi::CADDocument>,
}

impl Document {
    pub fn new() -> Self {
        Self {
            inner: ffi::create_document(),
        }
    }
    
    pub fn extrude(&mut self, sketch_id: &str, depth: f64) {
        self.inner.pin_mut().add_feature("extrude", &vec![depth]);
        self.inner.pin_mut().recompute();
    }
    
    pub fn get_mesh(&self, part_id: &str) -> Vec<u8> {
        self.inner.get_mesh(part_id)
    }
}
```

**C++ Implementation (`native/cad-core/document.h`)**

```cpp
#pragma once
#include <TopoDS_Shape.hxx>
#include <vector>
#include <string>

class CADDocument {
private:
    std::vector<TopoDS_Shape> shapes;
    std::vector<std::string> feature_history;
    
public:
    CADDocument();
    ~CADDocument();
    
    void add_feature(const std::string& type, const std::vector<double>& params);
    void recompute();
    bool export_step(const std::string& path);
    
    // Returns MessagePack binary data
    std::vector<uint8_t> get_mesh(const std::string& part_id);
    
    void update_sketch(const std::string& sketch_id, const std::string& geometry_json);
};
```

---

## Priority 4: Topological Naming Solution

### FreeCAD's Biggest Weakness, Solved Early

The topological naming problem occurs when geometry IDs change after recomputation. Your Rust layer is the perfect place to implement persistent naming.

**Persistent ID Mapping (`native/cad-core/src/topology.rs`)**

```rust
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct PersistentTopologyID {
    pub id: Uuid,
    pub generation: u32,  // Increments on recompute
}

pub struct TopologyMapper {
    // Maps persistent ID -> current OCCT entity reference
    persistent_to_current: HashMap<Uuid, OCCTEntityRef>,
    
    // Maps OCCT's volatile ID -> persistent ID
    current_to_persistent: HashMap<String, Uuid>,
    
    // History of renames (for debugging)
    rename_history: Vec<(Uuid, Uuid)>,
}

impl TopologyMapper {
    pub fn new() -> Self {
        Self {
            persistent_to_current: HashMap::new(),
            current_to_persistent: HashMap::new(),
            rename_history: Vec::new(),
        }
    }
    
    /// After a recompute, we need to remap IDs
    /// This is the critical function that FreeCAD gets wrong
    pub fn remap_after_recompute(
        &mut self,
        old_entities: Vec<OCCTEntityRef>,
        new_entities: Vec<OCCTEntityRef>,
    ) {
        // Strategy: Match entities by geometric properties
        // (center point, bounding box, edge length, etc.)
        for new_entity in &new_entities {
            if let Some(old_entity) = self.find_matching_entity(old_entities, new_entity) {
                // Found match - preserve the persistent ID
                if let Some(persistent_id) = self.current_to_persistent.get(&old_entity.id) {
                    self.persistent_to_current.insert(*persistent_id, new_entity.clone());
                    self.current_to_persistent.insert(new_entity.id.clone(), *persistent_id);
                }
            } else {
                // New entity - generate fresh persistent ID
                let new_id = Uuid::new_v4();
                self.persistent_to_current.insert(new_id, new_entity.clone());
                self.current_to_persistent.insert(new_entity.id.clone(), new_id);
            }
        }
    }
    
    fn find_matching_entity(
        &self,
        old_entities: Vec<OCCTEntityRef>,
        new_entity: &OCCTEntityRef,
    ) -> Option<OCCTEntityRef> {
        // Calculate geometric signature
        let new_signature = new_entity.geometric_signature();
        
        old_entities.into_iter()
            .find(|old| old.geometric_signature() == new_signature)
    }
}

#[derive(Clone)]
pub struct OCCTEntityRef {
    pub id: String,  // OCCT's internal ID (changes on recompute!)
    pub entity_type: EntityType,
    pub center: Option<[f64; 3]>,
    pub bounding_box: Option<[[f64; 3]; 2]>,
}

impl OCCTEntityRef {
    pub fn geometric_signature(&self) -> String {
        // Create a deterministic string that describes the geometry
        // This is simpler than it sounds - use a hash of:
        // - Entity type (vertex, edge, face)
        // - For vertices: coordinates
        // - For edges: length, curvature
        // - For faces: area, centroid
        format!(
            "{:?}|{:?}|{:?}",
            self.entity_type,
            self.center,
            self.bounding_box
        )
    }
}
```

**Integration with Tauri:**

```rust
#[tauri::command]
async fn get_feature_reference(
    state: tauri::State<'_, AppState>,
    persistent_id: String,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&persistent_id)
        .map_err(|_| "Invalid UUID")?;
    
    let entity_ref = state.topology_mapper
        .get_current_entity(&uuid)
        .ok_or("Entity not found")?;
    
    // Return OCCT's current ID (for C++ operations)
    Ok(entity_ref.id)
}
```

---

## Implementation Roadmap

### Phase 0: Foundation (Week 1-2)

- [x] Repository setup with Tauri + React
- [x] OpenCascade vendored and building
- [x] Basic IPC handshake working
- [x] C++ core can create a simple box

### Phase 1: Local Solver (Week 3-4) - CRITICAL

- [ ] Compile planegcs to WebAssembly
- [ ] TypeScript wrapper for WASM solver
- [ ] React hook for sketch interaction
- [ ] Canvas component with real-time solving
- [ ] Debounced sync to C++ core

**Milestone**: User can drag a sketch point at 60fps

### Phase 2: Binary Protocol (Week 5)

- [ ] MessagePack schema definitions
- [ ] Rust serialization/deserialization
- [ ] TypeScript MessagePack client
- [ ] Replace JSON IPC with MessagePack

**Milestone**: IPC messages 60% smaller, encode/decode 3x faster

### Phase 3: Document Model (Week 6-8)

- [ ] C++ document class with feature history
- [ ] Rust FFI bindings using CXX
- [ ] Sketch persistence to document
- [ ] Extrude operation from sketch

**Milestone**: Create a sketch, extrude to 3D, all state persists

### Phase 4: Topological Naming (Week 9-10)

- [ ] TopologyMapper implementation
- [ ] Integration with recompute operations
- [ ] Feature references use persistent IDs
- [ ] Test: modify early feature, later references survive

**Milestone**: Edit a sketch that's referenced by a later fillet, fillet doesn't break

### Phase 5: Polish & Performance (Week 11-12)

- [ ] WebGL rendering with Three.js
- [ ] Anti-aliasing and smooth lines
- [ ] Constraint visualization
- [ ] Undo/redo through IPC

**Milestone**: Full sketcher workflow feels professional

---

## Code Examples & Templates

### React Component Template

```typescript
// src/components/SketcherView.tsx
import React, { useState, useEffect } from 'react';
import { useSketchSolver } from '../hooks/useSketchSolver';
import { Canvas } from '@react-three/fiber';

export function SketcherView({ documentId, sketchId }: Props) {
  const [loading, setLoading] = useState(true);
  const [sketch, setSketch] = useState(null);
  
  useEffect(() => {
    // Load sketch from C++ core via IPC
    window.__TAURI__.invoke('load_sketch', { documentId, sketchId })
      .then(setSketch)
      .finally(() => setLoading(false));
  }, [documentId, sketchId]);
  
  const { state, solveLocal, syncToCore } = useSketchSolver(sketch);
  
  if (loading) return <div>Loading...</div>;
  
  return (
    <div className="sketcher-view">
      <SketchCanvas 
        sketch={state}
        onDrag={(pointId, pos) => solveLocal(pointId, pos)}
        onDragEnd={() => syncToCore()}
      />
      <ConstraintPanel constraints={state.constraints} />
    </div>
  );
}
```

### Tauri Command Template

```rust
// native/cad-core/src/commands.rs
#[tauri::command]
async fn extrude_from_sketch(
    state: tauri::State<'_, AppState>,
    sketch_id: String,
    depth: f64,
) -> Result<String, String> {
    // Lock document
    let mut doc = state.document.lock().unwrap();
    
    // Perform extrusion using OpenCascade
    let result_id = doc.extrude_sketch(&sketch_id, depth)
        .map_err(|e| format!("Extrude failed: {}", e))?;
    
    // Trigger recompute
    doc.recompute();
    
    // Return persistent ID of the new feature
    Ok(result_id.to_string())
}
```

### OpenCascade Utility Wrapper

```cpp
// native/cad-core/src/occt_utils.cpp
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepExtrema_DistShapeShape.hxx>

class OCCTWrapper {
public:
    static TopoDS_Shape make_box(double x, double y, double z) {
        return BRepPrimAPI_MakeBox(x, y, z).Shape();
    }
    
    static TopoDS_Shape extrude(const TopoDS_Face& sketch, double depth) {
        return BRepPrimAPI_MakePrism(sketch, gp_Vec(0, 0, depth)).Shape();
    }
    
    static std::vector<Triangle> tesselate(const TopoDS_Shape& shape, double deflection) {
        // Use BRepMesh_IncrementalMesh
        BRepMesh_IncrementalMesh(shape, deflection);
        
        // Extract triangles using TopExp_Explorer
        std::vector<Triangle> triangles;
        // ... implementation ...
        return triangles;
    }
};
```

---

## Testing Strategy

### Unit Tests (C++)

```cpp
// tests/document_test.cpp
TEST(CADDocument, ExtrudeFromSketch) {
    CADDocument doc;
    auto sketch_id = doc.create_sketch();
    doc.add_line_to_sketch(sketch_id, Point(0,0), Point(10,0));
    doc.add_line_to_sketch(sketch_id, Point(10,0), Point(10,10));
    doc.add_line_to_sketch(sketch_id, Point(10,10), Point(0,10));
    doc.add_line_to_sketch(sketch_id, Point(0,10), Point(0,0));
    
    auto extrude_id = doc.extrude(sketch_id, 5.0);
    
    ASSERT_TRUE(doc.is_valid(extrude_id));
    auto volume = doc.measure_volume(extrude_id);
    EXPECT_NEAR(volume, 500.0, 0.01);  // 10x10x5 = 500
}
```

### Integration Tests (IPC)

```typescript
// tests/ipc/document.test.ts
import { describe, it, expect } from 'vitest';

describe('IPC Document Lifecycle', () => {
  it('should create sketch, extrude, and persist', async () => {
    const docId = await invoke('create_document');
    
    const sketchId = await invoke('create_sketch', { docId });
    await invoke('add_constraint', { sketchId, type: 'horizontal' });
    
    const extrudeId = await invoke('extrude', { 
      sketchId, 
      depth: 10 
    });
    
    const mesh = await invoke('get_mesh', { partId: extrudeId });
    expect(mesh.vertices.length).toBeGreaterThan(0);
    
    // Save and reload
    await invoke('save_document', { docId, path: 'test.polysmith' });
    const newDocId = await invoke('load_document', { path: 'test.polysmith' });
    
    const loadedFeatures = await invoke('list_features', { docId: newDocId });
    expect(loadedFeatures).toContain(extrudeId);
  });
});
```

### Performance Benchmarks

```typescript
// tests/performance/solver.bench.ts
import { bench } from 'vitest';

bench('Local solver - 50 constraints', () => {
  const result = solver.solve(complexGeometry, complexConstraints);
  expect(result.solved).toBe(true);
}, { time: 1000 });  // Should average <5ms per solve

bench('IPC round-trip - sketch update', async () => {
  await invoke('sketch_update', { sketchId, geometry, constraints });
}, { time: 1000 });  // Should average <10ms per call
```

---

## Performance Benchmarks

Target metrics for a smooth CAD experience:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Solver latency (local) | <5ms | Time to solve 50-constraint sketch |
| IPC round-trip (simple) | <10ms | Time for ping-pong with 1KB payload |
| Sketcher frame rate | 60fps | Frames per second during drag |
| Mesh transfer (10K triangles) | <50