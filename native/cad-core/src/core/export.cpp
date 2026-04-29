#include "core/export.h"

#include <stdexcept>
#include <vector>

#include <BRep_Builder.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Writer.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include "core/body_compiler.h"
#include "core/document.h"

namespace polysmith::core {
namespace {

std::vector<TopoDS_Shape> collect_export_shapes(const DocumentState& document) {
  // Reuse the body compiler so STEP/STL exports honor cut/join modes:
  // any extrude with mode=cut|join is fused/subtracted into its target
  // body, and we export the resulting boolean'd solids rather than the
  // raw source primitives.
  std::vector<TopoDS_Shape> shapes;
  const CompiledBodies compiled = compile_bodies(document);
  for (const auto& body : compiled.bodies) {
    if (!body.shape.IsNull()) {
      shapes.push_back(body.shape);
    }
  }
  return shapes;
}

}  // namespace

ExportResult export_document_as_step(const DocumentState& document,
                                     const std::string& file_path) {
  if (file_path.empty()) {
    throw std::runtime_error("Export path cannot be empty");
  }

  const std::vector<TopoDS_Shape> shapes = collect_export_shapes(document);
  if (shapes.empty()) {
    throw std::runtime_error("No solid features are available to export");
  }

  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);

  for (const auto& shape : shapes) {
    builder.Add(compound, shape);
  }

  STEPControl_Writer writer;
  const IFSelect_ReturnStatus transfer_status =
      writer.Transfer(compound, STEPControl_AsIs);
  if (transfer_status != IFSelect_RetDone) {
    throw std::runtime_error("STEP transfer failed");
  }

  const IFSelect_ReturnStatus write_status = writer.Write(file_path.c_str());
  if (write_status != IFSelect_RetDone) {
    throw std::runtime_error("STEP write failed for path: " + file_path);
  }

  return ExportResult{
      .file_path = file_path,
      .format = "step",
      .exported_feature_count = static_cast<int>(shapes.size()),
  };
}

ExportResult export_document_as_stl(const DocumentState& document,
                                    const std::string& file_path) {
  if (file_path.empty()) {
    throw std::runtime_error("Export path cannot be empty");
  }

  const std::vector<TopoDS_Shape> shapes = collect_export_shapes(document);
  if (shapes.empty()) {
    throw std::runtime_error("No solid features are available to export");
  }

  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);

  for (const auto& shape : shapes) {
    builder.Add(compound, shape);
  }

  // Tessellate the compound. The default ASCII STL writer requires that
  // every face in the shape carry a triangulation. Linear deflection of
  // 0.1 mm and angular deflection of 0.5 rad gives smooth-enough output
  // for hobbyist 3D-print slicers without producing huge files.
  constexpr double kLinearDeflection = 0.1;
  constexpr double kAngularDeflection = 0.5;
  BRepMesh_IncrementalMesh mesher(compound,
                                  kLinearDeflection,
                                  /*isRelative=*/false,
                                  kAngularDeflection,
                                  /*isInParallel=*/true);
  if (!mesher.IsDone()) {
    throw std::runtime_error("STL meshing failed");
  }

  StlAPI_Writer writer;
  writer.ASCIIMode() = false;  // binary STL, smaller files
  if (!writer.Write(compound, file_path.c_str())) {
    throw std::runtime_error("STL write failed for path: " + file_path);
  }

  return ExportResult{
      .file_path = file_path,
      .format = "stl",
      .exported_feature_count = static_cast<int>(shapes.size()),
  };
}

}  // namespace polysmith::core
