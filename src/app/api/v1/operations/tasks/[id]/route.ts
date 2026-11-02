import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { withDbUser } from "@/lib/db";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const actor=await getSession();
  if(!actor) return NextResponse.json({error:"Authentication required."},{status:401});
  if(!hasAnyPermission(actor,["operations.task.manage","*"])) return NextResponse.json({error:"Permission denied."},{status:403});
  const {id}=await params;
  const body=await request.json();
  if(!["todo","in_progress","blocked","done","cancelled"].includes(body.status)) return NextResponse.json({error:"Invalid task status."},{status:400});
  try {
    return await withDbUser(actor.id,null,async(client)=>{
      const result=await client.query(`UPDATE tasks SET status=$1,completed_at=CASE WHEN $1='done' THEN COALESCE(completed_at,now()) ELSE NULL END WHERE id=$2 RETURNING *`,[body.status,id]);
      if(!result.rowCount) return NextResponse.json({error:"Task not found."},{status:404});
      return NextResponse.json(result.rows[0]);
    });
  } catch(error) {
    console.error("Unable to update task.",error);
    return NextResponse.json({error:"Unable to update task."},{status:500});
  }
}
