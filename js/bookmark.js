"use strict;"

$(() =>
{
	$("#bookmarksContainer").dialog(
	{
		containment: "#mainContainer",
		autoOpen: false,
		title: "Bookmarks",
		width: 760,
		minWidth: 250,
	})


	$("#addbookmarkComment").dialog(
	{
		containment: "#mainContainer",
		modal: true,
		open: () =>
		{
			Stop();
			$("#addbookmarkComment").dialog("option", "title", "Add bookmark: " + getTimeStringOfTick(Tick_Current));
			$("#bookmarkCommentField")[0].value = ""
		},
		buttons:
		{
			"OK": () =>
			{
				var c = $("#bookmarkCommentField")[0].value
				bookmarks_Add(c);
				$("#addbookmarkComment").dialog("close");
			}
		},
		autoOpen: false,
		resizable: false,
		width: 600,
	})

})

bookmarks_List = []

function bookmarks_Add(_Comment)
{
	var bookmark = {
		"tick": Tick_Current,
		"comment": _Comment,
	}

	var index = bookmarks_List.findIndex((i) =>
	{
		return (i.tick > Tick_Current)
	})
	if (index == -1)
		bookmarks_List.push(bookmark)
	else
		bookmarks_List.splice(index, 0, bookmark);
	bookmarks_WriteAll()
	bookmarks_Save()
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.draw === "function") {
		analyserTimeline.draw();
	}
}

function bookmarks_Delete(b)
{
	var index = bookmarks_List.indexOf(b);
	if (index == -1)
		return

	bookmarks_List.splice(index, 1);

	bookmarks_Save()
	bookmarks_WriteAll()
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.draw === "function") {
		analyserTimeline.draw();
	}
}

function bookmarks_Save()
{
	var key = (IPPort + " " + StartTime) // IP plus start time sounds unique enough
	var value = JSON.stringify(bookmarks_List)
	localStorage[key] = value
}

function bookmarks_Load()
{
	var key = (IPPort + " " + StartTime)
	if (key in localStorage) {
		try {
			bookmarks_List = JSON.parse(localStorage[key]) || [];
		} catch (e) {
			bookmarks_List = [];
		}
	}

	bookmarks_WriteAll()
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.draw === "function") {
		analyserTimeline.draw();
	}
}

function bookmarks_WriteOne(b)
{
	const time = getTimeStringOfTick(b.tick)
	const safeComment = typeof escapeHtml === "function" ? escapeHtml(b.comment || "") : String(b.comment || "")
	const table = $("#bookmarksTable")[0]

	var row = table.insertRow(-1)
	row.insertCell(0).innerHTML = time
	row.insertCell(1).innerHTML = "<label style='cursor:pointer; display:block; min-height:16px;' title='Click to edit comment'>" + (safeComment || "<i>(no comment)</i>") + "</label>" +
		"<input style='display:none; width:95%; background:#1f2b2a; color:#fff; border:1px solid #8fa3a1; padding:1px 4px;'></input>"
	row.insertCell(2).innerHTML = "X"
	row.cells[0].style.cursor = "pointer"
	row.cells[2].style.cursor = "pointer"

	row.cells[0].onclick = () => goTo(b.tick)
	row.cells[2].onclick = () => bookmarks_Delete(b)

	const label = $(row.cells[1]).find("label")
	const input = $(row.cells[1]).find("input")

	label.on("click", () => {
		label.css('display', 'none');
		input
			.val(b.comment || "")
			.css('display', '')
			.focus();
	});

	const commitEdit = () => {
		b.comment = input.val();
		input.css('display', 'none');
		const updatedSafe = typeof escapeHtml === "function" ? escapeHtml(b.comment || "") : String(b.comment || "");
		label.html(updatedSafe || "<i>(no comment)</i>").css('display', 'block');
		bookmarks_Save();
		if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.draw === "function") {
			analyserTimeline.draw();
		}
	};

	input.on("blur", commitEdit);
	input.on("keydown", (ev) => {
		if (ev.key === "Enter") {
			ev.preventDefault();
			input.blur();
		} else if (ev.key === "Escape") {
			ev.preventDefault();
			input.val(b.comment || "");
			input.blur();
		}
	});
}

// Clear the table and rewrite all
function bookmarks_WriteAll()
{
	$("#bookmarksTable tr:gt(0)").remove()
	bookmarks_List.forEach(bookmarks_WriteOne)
}